"""Unit pins for command_sequencing against synthetic worker receipts.

Why: run 42675368995 raced two model commands on the shared model-command.json
(see command_sequencing.py). These pin the three refusals the preflight relies
on without a serving graph: wait for THIS call id, refuse a mismatched tool
under it, refuse overwriting a command no turn has emitted.
"""
import json
from pathlib import Path
import tempfile
import unittest

from command_sequencing import (SequencingError, assert_previous_consumed,
                                own_emission, receipts_tail)


class CommandSequencingTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def note(self, pid, **event):
        with (self.root / ('bootstrap-%d.jsonl' % pid)).open('a') as out:
            out.write(json.dumps({'pid': pid, **event}) + '\n')

    def command(self, cid, tool):
        (self.root / 'model-command.json').write_text(json.dumps({'id': cid, 'tool': tool, 'args': {}}))

    def test_waits_for_its_own_call_id(self):
        # The 42675368995 shape: requests carried another id, then a later one.
        self.note(1, event='tool_emitted', tool='generate_music', call_id='gen')
        self.note(1, event='model_request', command_id='status')
        self.assertIsNone(own_emission(self.root, 'status', 'music_status'))
        self.note(2, event='tool_emitted', tool='music_status', call_id='status')
        self.assertEqual(own_emission(self.root, 'status', 'music_status'), 'music_status')

    def test_ignores_partial_trailing_line(self):
        self.note(1, event='tool_emitted', tool='music_status', call_id='status')
        with (self.root / 'bootstrap-1.jsonl').open('a') as out:
            out.write('{"event": "tool_emi')
        self.assertEqual(own_emission(self.root, 'status', 'music_status'), 'music_status')

    def test_refuses_mismatched_tool(self):
        self.note(1, event='tool_emitted', tool='modify_music', call_id='status')
        with self.assertRaises(SequencingError):
            own_emission(self.root, 'status', 'music_status')

    def test_refuses_double_emission(self):
        self.note(1, event='tool_emitted', tool='music_status', call_id='status')
        self.note(1, event='tool_emitted', tool='music_status', call_id='status')
        with self.assertRaises(SequencingError):
            own_emission(self.root, 'status', 'music_status')

    def test_refuses_overwriting_unconsumed_command(self):
        self.command('status', 'music_status')
        self.note(1, event='model_request', command_id='status')
        with self.assertRaises(SequencingError):
            assert_previous_consumed(self.root)
        self.note(1, event='tool_emitted', tool='music_status', call_id='status')
        assert_previous_consumed(self.root)

    def test_first_command_has_no_predecessor(self):
        assert_previous_consumed(self.root)

    def test_receipts_tail_drops_paths_and_tool_lists(self):
        self.note(1, event='loaded', config='/secret/path', executable='/x')
        self.note(1, event='model_request', registered_tools=['a'], command_id='c')
        self.assertEqual(receipts_tail(self.root),
                         [{'event': 'loaded', 'pid': 1},
                          {'event': 'model_request', 'pid': 1, 'command_id': 'c'}])


if __name__ == '__main__':
    unittest.main()
