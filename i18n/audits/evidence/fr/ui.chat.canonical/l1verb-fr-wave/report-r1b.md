# Audit fr-B — tool_row.verb.* (182 keys) — auditor l1-au-fr-B (anthropic/claude-sonnet-5-5)

Verdict: changes_requested (0 BLOCKER, 2 MAJOR, 6 MINOR, 3 NIT). Independent of translator (openai/gpt-6.1-sol).

## Mechanical (python3)
- key set AND order identical to keys.json (182/182); no empty values; no value identical to English; no placeholders in this group; no ASCII `'` (all U+2019); no bidi control chars; every value 1-4 words (max 30 chars: "A déclenché l’alerte d’urgence").
- Only duplicate-rendering collision: viewed_session ≡ peeked_at_session (see m2).
- Settled/running stems pair correctly in all 91 pairs (same lemma each time).

## MAJOR
**M1 — settled form "A + participe" (87 of 91 settled values) contradicts the fr style guide and the shipped copy.**
Guide: "statuses are past participles ('Enregistré', 'Repris')". Shipped bridge verbs are participles/nominals: "Publié dans", "Conversations listées", "Fil lu dans", "Réaction retirée dans", "Publication dans", "Lecture du fil dans". The new file also mixes schemes itself: updated_secure_input.settled "Saisie sécurisée actualisée", linked_session_to.settled "Session liée à", unlinked_session_from.settled "Session dissociée de", read_network_log.settled "Journal réseau lu" are participial; the other 87 are subject-less passé composé ("A exécuté", "A lu", "A listé les sessions"), which reads as a sentence missing its subject and puts a stray capital "A" at the gutter edge. Running forms are bare 3rd-person presents ("Exécute", "Lit", "Écrit", "Liste", "Crée") that read as imperatives/fragments; "Liste les sessions"/"Liste" also reads as the noun "Liste" before a monospace object (shipped already has "Liste des conversations" for running).
Suggested (one scheme, consistent with shipped): settled = participle (noun-first where an object needs agreement), running = verbal noun. e.g. ran "Exécuté"/"Exécution de"; read "Lu"/"Lecture de"; wrote "Écrit"/"Écriture de"; edited "Modifié"/"Modification de"; listed_sessions "Sessions listées"/"Liste des sessions" (or "Listage des sessions"); deleted_team "Équipe supprimée"/"Suppression de l’équipe"; stopped_session "Session arrêtée"/"Arrêt de la session"; created_project "Projet créé"/"Création du projet". If the manager prefers to keep the verbal "A …/Verbe" scheme for width reasons, it must be applied uniformly (incl. the 4 outliers) and the guide deviation recorded; I judge it a guide violation as-is.

**M2 — raised_panic understates a destructive action.**
raised_panic.settled "A déclenché l’alerte d’urgence" / .running "Déclenche l’alerte d’urgence". Source: network tool `panic` = "broadcast a revoke and rotate the secret for every member" (local_operator/network/tool.py:629, cli.py:744). "alerte" reads as a notification; the real effect is revocation + secret rotation. Suggested: settled "A lancé la révocation d’urgence" (or "Révocation d’urgence lancée"), running "Lance la révocation d’urgence" ("Lancement de la révocation d’urgence"). Also shorter (fit).

## MINOR
- m1 updated_* use "actualiser" (A actualisé l’agent/l’équipe/le projet/le jalon/le secret/les tâches, saisie sécurisée actualisée, + running). Shipped fr uses "Mis à jour" for "updated" (ui.agents.pages.change.updated) and "actualisation" for refresh; here the ops are edits, not refreshes. Suggest "Mis à jour"/"Mise à jour de" (or "A mis à jour l’agent"/"Met à jour l’agent").
- m2 peeked_at_session ("A consulté la session"/"Consulte la session") renders identically to viewed_session (`info`) — two different ops indistinguishable. Suggest "A inspecté la session"/"Inspecte la session"; likewise peeked_at ("A consulté"/"Consulte") → "A inspecté"/"Inspecte" (hub/jobs peek).
- m3 typed_in_console "A saisi en console"/"Saisit en console": "en console" is unidiomatic. Suggest "A saisi dans la console"/"Saisit dans la console" (keep the trailing "dans la console" before the monospace object).
- m4 checked_network_status "A vérifié le réseau"/"Vérifie le réseau" drops "status" and is near-identical to diagnosed_network (`doctor`) in effect. Suggest "État du réseau vérifié"/"Vérification de l’état du réseau" (or "Vérifie l’état du réseau").
- m5 retrieved_secret "A récupéré le secret"/"Récupère le secret": the `secret` tool's retrieve never returns the value; "récupéré" implies the value was fetched/shown, and shares its verb with web_fetch (fetched = "A récupéré"). Suggest "A chargé le secret"/"Charge le secret" or "Secret rendu utilisable" (judgement; at minimum avoid implying disclosure).
- m6 listed_network_peers "A listé les pairs": "pairs" alone is opaque; glossary prefers appareil for device. Suggest "A listé les appareils du réseau"/"Liste les appareils du réseau" (4 words) or "les pairs du réseau".

## NIT
- n1 searched_the_web "sur Internet" → "sur le web" (more current in fr UI; glossary neutral).
- n2 read_todos "A lu les tâches" and listed_jobs/waited_for_jobs "…les tâches": glossary maps job→tâche; todo list shares the word. Prefer "la liste de tâches" for todo (read_todos/updated_todos) to keep them apart.
- n3 captured_console (`screenshot`) "A capturé la console" could read as recording; "A capturé l’écran de la console" if width allows.

## Clean points checked
Meaning fidelity of every other key vs context.role (destructive/non-destructive verbs not swapped: deleted_*/removed_*/cancelled_*/stopped/paused/left_network all correct; resume = "reprendre" per guide); trailing relation kept (… à / … de / … à la session); glossary: session, wake→réveil, agent, sous-agent, équipe, projet, appareil, tâche, planification (scheduled) conform; tool names/Python kept; "ask/asked", "delegated", "received" fine.
