import os,pathlib,asyncio,json
root=pathlib.Path(os.environ['LOCAL_OPERATOR_SCRATCHPAD'])/'final-audio-inputs'
os.environ['HOME']=str(root/'validation-home');os.environ['LOCAL_OPERATOR_CONFIG_DIR']=str(root/'validation-config')
from local_operator.tools.audio_tool import execute_generate_sound_effect
from local_operator.harness.types import InvalidToolArgumentsError
async def main():
 try: result=await execute_generate_sound_effect('fresh-invalid-class',{'prompt':'a door creak','model':'radient/sound-effects'})
 except InvalidToolArgumentsError as e:
  assert 'duration_s' in str(e)
  data={'exception':type(e).__name__,'error_type':'invalid_arguments','reason':str(e),'source':'merged audio_tool.execute_generate_sound_effect validation; InvalidToolArgumentsError documented executor mapping in harness/types.py'}
  (root/'refusal-class.json').write_text(json.dumps(data,indent=2));print(json.dumps(data))
 else:
  data=result.model_dump(mode='json');print(json.dumps(data));assert result.is_error
  (root/'refusal-class.json').write_text(json.dumps(data,indent=2))
asyncio.run(main())
