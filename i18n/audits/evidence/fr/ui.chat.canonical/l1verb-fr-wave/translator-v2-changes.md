# French L1 remediation — v2

- Locale: `fr`; scope: 182 tool-row verb keys / 91 pairs.
- Translator: `i18n-translator`, session `7ceb88d7c5f8`, actual served model **openai/gpt-6.1-sol** (this session’s Model header). No fallback or MT service used.
- Inputs: `keys.json`, `fr.json`, independent `audit-fr-A.md` and `audit-fr-B.md`; core `i18n/style-guides/fr.md`, `en.md`, `i18n/glossary.md`; shipped UI French catalogues.
- **182 changed keys; 22 fixed findings; 1 declined finding (B:n2); 0 deferred.** This is translation remediation, NOT an independent audit or an audit pass. No catalogue, ledger or prior evidence bundle was modified; no commit made.

## Verified evidence and choices

French guide, Formality & tone: “statuses are past participles”, examples Enregistré / Repris. Shipped bridge forms read Lu dans / Lecture dans; Envoyé à / Envoi à; Créé / Création. Thus the entire slice now follows bare participles for settled rows and action nominals for running rows. The task’s explicit action-before-object requirement wins over the auditors’ optional noun-first examples. Articles may be omitted in compact nominal labels (Consultation d’agent + monospace name); no trailing relation is lost.

Counted directly across non-context shipped `fr/*.json`: `mise à jour` 206; `mis à jour` 49; `actualisé` 2; plural `pairs` 0; `appareils` 10; `jalon` 32; `console` 49; `liste de tâches` 1. These reproduce A’s surprising update counts rather than trusting its summary. Guide fixes job → tâche and wake → réveil. Existing todo rows also use tâches. Network panic semantics checked in core `local_operator/network/tool.py` (operation description at line 629; untrusted-network behavior around line 1414), not inferred from the English word panic. Secret retrieve’s no-value-return contract is present in the supplied tool description. Each operation was read against its `keys.json` context.role.

`messaged` uses the shipped bridge DM pair Envoyé à / Envoi à rather than an unnatural nominal Écriture à. `joined_network` uses Connecté au réseau / Connexion au réseau (A:F-03 specifically recommends Connexion au réseau). Found definition/references use Trouvé / Recherche: the natural running action is a search, not the unnatural nominal Trouvaille.

## Finding decisions

IDs retain their report prefix: A:F-01…F-12; B:M1/M2, m1…m6, n1…n3. “fixed” means present in the v2 preparation file, not committed or independently passed.

| Finding | Decision | Key, old → new | Evidence / rationale |
|---|---|---|---|
| A:F-01 | fixed | `updated_agent.settled`: A actualisé l’agent → Mis à jour l’agent<br>`updated_agent.running`: Actualise l’agent → Mise à jour d’agent<br>`updated_team.settled`: A actualisé l’équipe → Mis à jour l’équipe<br>`updated_team.running`: Actualise l’équipe → Mise à jour d’équipe<br>`updated_secret.settled`: A actualisé le secret → Mis à jour le secret<br>`updated_secret.running`: Actualise le secret → Mise à jour de secret<br>`updated_project.settled`: A actualisé le projet → Mis à jour le projet<br>`updated_project.running`: Actualise le projet → Mise à jour de projet<br>`updated_milestone.settled`: A actualisé le jalon → Mis à jour le jalon<br>`updated_milestone.running`: Actualise le jalon → Mise à jour de jalon<br>`updated_todos.settled`: A actualisé les tâches → Mis à jour les tâches<br>`updated_todos.running`: Actualise les tâches → Mise à jour de tâches<br>`updated_secure_input.settled`: Saisie sécurisée actualisée → Mis à jour la saisie sécurisée<br>`updated_secure_input.running`: Actualise la saisie sécurisée → Mise à jour de saisie sécurisée | Use the shipped update family, not actualiser (refresh). |
| A:F-02 | fixed | `peeked_at.settled`: A consulté → Inspecté<br>`peeked_at.running`: Consulte → Inspection de<br>`peeked_at_session.settled`: A consulté la session → Inspecté la session<br>`peeked_at_session.running`: Consulte la session → Inspection de session | Inspecter distinguishes content inspection from metadata consultation; no survoler, which suggests cursory reading. |
| A:F-03 | fixed | Full register delta below | Systemic register fix across ALL 182 values: bare-participle settled statuses, nominal running actions. Full key-by-key old → new table below. Verb/action first throughout; no object-first exception. |
| A:F-04 | fixed | `raised_panic.settled`: A déclenché l’alerte d’urgence → Révoqué d’urgence<br>`raised_panic.running`: Déclenche l’alerte d’urgence → Révocation d’urgence de | Explicit emergency revocation, not a mere alert; tightened to 2/3 words. Rotation is part of that operation, not silently redefined as notification. |
| A:F-05 | fixed | `searched_the_web.settled`: A recherché sur Internet → Recherché sur le web<br>`searched_the_web.running`: Recherche sur Internet → Recherche sur le web | Use shipped web vocabulary; Internet remains the connection concept. |
| A:F-06 | fixed | `checked_network_status.settled`: A vérifié le réseau → Vérifié l’état du réseau<br>`checked_network_status.running`: Vérifie le réseau → Vérification d’état du réseau | Restore état. This is network status, not doctor; the report’s reference to doctor here is incorrect per keys.json context.role. |
| A:F-07 | fixed | `typed_in_console.settled`: A saisi en console → Saisi dans la console<br>`typed_in_console.running`: Saisit en console → Saisie dans la console | Natural dans la console; both halves four words. |
| A:F-08 | fixed | `read_network_log.settled`: Journal réseau lu → Lu le journal réseau<br>`read_network_log.running`: Lit le journal réseau → Lecture du journal réseau<br>`updated_secure_input.settled`: Saisie sécurisée actualisée → Mis à jour la saisie sécurisée<br>`updated_secure_input.running`: Actualise la saisie sécurisée → Mise à jour de saisie sécurisée<br>`linked_session_to.settled`: Session liée à → Lié la session à<br>`linked_session_to.running`: Lie la session à → Liaison de session à<br>`unlinked_session_from.settled`: Session dissociée de → Dissocié la session de<br>`unlinked_session_from.running`: Dissocie la session de → Dissociation de session de | All four are action-first in BOTH halves; à/de relations preserved. |
| A:F-09 | fixed | `paused.settled`: A suspendu → Mis en pause<br>`paused.running`: Suspend → Mise en pause de<br>`steered.settled`: A réorienté → Orienté<br>`steered.running`: Réoriente → Orientation de | Use mise en pause and orienter, matching shipped pause/steer terminology. |
| A:F-10 | fixed | `listed_network_peers.settled`: A listé les pairs → Listé les appareils réseau<br>`listed_network_peers.running`: Liste les pairs → Liste des appareils réseau | Use appareils réseau to identify network members without opaque bare pairs; both halves four words. |
| A:F-11 | fixed | `captured_console.settled`: A capturé la console → Capturé l’écran de console<br>`captured_console.running`: Capture la console → Capture d’écran de console | Explicit screen capture: écran / capture d’écran, not capture of the terminal process. |
| A:F-12 | fixed | `sent_keys.settled`: A envoyé des touches → Envoyé les touches<br>`sent_keys.running`: Envoie des touches → Envoi des touches | Definite touches matches the following key sequence. |
| B:M1 | fixed | Full register delta below | Same systemic register remediation as A:F-03; all 91 pairs use participial status / action nominal. Full table below. The suggested object-first examples were not adopted because this task explicitly requires action before the monospace object. |
| B:M2 | fixed | `raised_panic.settled`: A déclenché l’alerte d’urgence → Révoqué d’urgence<br>`raised_panic.running`: Déclenche l’alerte d’urgence → Révocation d’urgence de | Same explicit revocation remediation as A:F-04. |
| B:m1 | fixed | `updated_agent.settled`: A actualisé l’agent → Mis à jour l’agent<br>`updated_agent.running`: Actualise l’agent → Mise à jour d’agent<br>`updated_team.settled`: A actualisé l’équipe → Mis à jour l’équipe<br>`updated_team.running`: Actualise l’équipe → Mise à jour d’équipe<br>`updated_secret.settled`: A actualisé le secret → Mis à jour le secret<br>`updated_secret.running`: Actualise le secret → Mise à jour de secret<br>`updated_project.settled`: A actualisé le projet → Mis à jour le projet<br>`updated_project.running`: Actualise le projet → Mise à jour de projet<br>`updated_milestone.settled`: A actualisé le jalon → Mis à jour le jalon<br>`updated_milestone.running`: Actualise le jalon → Mise à jour de jalon<br>`updated_todos.settled`: A actualisé les tâches → Mis à jour les tâches<br>`updated_todos.running`: Actualise les tâches → Mise à jour de tâches<br>`updated_secure_input.settled`: Saisie sécurisée actualisée → Mis à jour la saisie sécurisée<br>`updated_secure_input.running`: Actualise la saisie sécurisée → Mise à jour de saisie sécurisée | Same update terminology remediation as A:F-01. |
| B:m2 | fixed | `peeked_at.settled`: A consulté → Inspecté<br>`peeked_at.running`: Consulte → Inspection de<br>`peeked_at_session.settled`: A consulté la session → Inspecté la session<br>`peeked_at_session.running`: Consulte la session → Inspection de session | Same inspecter / inspection remediation as A:F-02. |
| B:m3 | fixed | `typed_in_console.settled`: A saisi en console → Saisi dans la console<br>`typed_in_console.running`: Saisit en console → Saisie dans la console | Same natural console preposition remediation as A:F-07. |
| B:m4 | fixed | `checked_network_status.settled`: A vérifié le réseau → Vérifié l’état du réseau<br>`checked_network_status.running`: Vérifie le réseau → Vérification d’état du réseau | Restore état; retain distinction from diagnosed_network. |
| B:m5 | fixed | `retrieved_secret.settled`: A récupéré le secret → Chargé le secret<br>`retrieved_secret.running`: Récupère le secret → Chargement de secret | Chargé / Chargement describes making a secret usable; it does not claim the value was returned or exposed. |
| B:m6 | fixed | `listed_network_peers.settled`: A listé les pairs → Listé les appareils réseau<br>`listed_network_peers.running`: Liste les pairs → Liste des appareils réseau | Appareils réseau follows the device terminology; no ambiguous standalone pairs. |
| B:n1 | fixed | `searched_the_web.settled`: A recherché sur Internet → Recherché sur le web<br>`searched_the_web.running`: Recherche sur Internet → Recherche sur le web | Same shipped web terminology remediation as A:F-05. |
| B:n2 | declined | No additional terminology change | Do not force liste de tâches into both todo phrases: the glossary explicitly fixes job → tâche, and shipped todo prose also uses tâches. Existing ui.chat.run_details.todos.* uses tâches; A §6 independently notes that this overlap is not a violation. Read remains Lu / Lecture and jobs-list remains Listé / Liste, so operations stay distinct; adding liste also lengthens the already five-word update formula. |
| B:n3 | fixed | `captured_console.settled`: A capturé la console → Capturé l’écran de console<br>`captured_console.running`: Capture la console → Capture d’écran de console | Same explicit capture d’écran remediation as A:F-11. |

## Width exceptions

Ten values exceed four whitespace-separated words. These are deliberate exceptions to retain the shipped term **mise à jour**, the direct-object article in settled French, and the distinction between ordinary input and **saisie sécurisée**. They are not truncations. Five-word values are only 19–21 characters, shorter than many four-word technical labels. The two six-word secure-input values are 30/31 characters, within the existing shipped bridge maximum (Annuaire de l’équipe consulté, 31). This is a disclosed translation exception, not a claim of rendered layout approval; independent re-check still required.

| Key | Value | Words | Characters |
|---|---|---:|---:|
| `updated_secret.settled` | Mis à jour le secret | 5 | 20 |
| `updated_secret.running` | Mise à jour de secret | 5 | 21 |
| `updated_project.settled` | Mis à jour le projet | 5 | 20 |
| `updated_project.running` | Mise à jour de projet | 5 | 21 |
| `updated_milestone.settled` | Mis à jour le jalon | 5 | 19 |
| `updated_milestone.running` | Mise à jour de jalon | 5 | 20 |
| `updated_todos.settled` | Mis à jour les tâches | 5 | 21 |
| `updated_todos.running` | Mise à jour de tâches | 5 | 21 |
| `updated_secure_input.settled` | Mis à jour la saisie sécurisée | 6 | 30 |
| `updated_secure_input.running` | Mise à jour de saisie sécurisée | 6 | 31 |

## Validation actually executed

- `python3` JSON/shape/control-character validation: 182 keys, exact source set AND order, zero empty/English-identical values, zero bidi/control characters; all 182 changed. No ICU/placeholders exist in this slice.
- `pnpm check-i18n:catalogues` in the manager worktree: **exit 1**. Generation byte-identical; duplicate scan PASS (1428 files, zero duplicates); string scan PASS (1660 files, 40 allowed data-shape literals). Ledger-check FAIL: 24 existing integration findings across 1106 entries (all seven non-English locales lack the new 182 source keys and have stale source/auditor hashes). This preparation task has not integrated any locale; verified independently that all 182 fr prep keys are absent from the shipped fr catalogue. Do not relabel this baseline failure as a v2 pass; manager must integrate the translated catalogues and fresh independent receipts.
- `node scripts/i18n/context-parity.mjs` separately: exit 0, every English key covered apart from 129 allowed gaps in four namespaces.
- No rendered proof or independent audit claimed. Translator never audits own work.

## Glossary proposals (not silently added)

- peek (content inspection): inspecter / inspection, distinguished from show/info consulter / consultation.
- panic (network incident): révocation d’urgence, not alerte d’urgence; underlying operation also rotates the secret and marks the network untrusted.

## Complete key delta (source order)

| Key | Old | New |
|---|---|---|
| `ran.settled` | A exécuté | Exécuté |
| `ran.running` | Exécute | Exécution de |
| `ran_python.settled` | A exécuté Python | Exécuté Python |
| `ran_python.running` | Exécute Python | Exécution Python |
| `read.settled` | A lu | Lu |
| `read.running` | Lit | Lecture de |
| `wrote.settled` | A écrit | Écrit |
| `wrote.running` | Écrit | Écriture de |
| `edited.settled` | A modifié | Modifié |
| `edited.running` | Modifie | Modification de |
| `listed.settled` | A listé | Listé |
| `listed.running` | Liste | Liste de |
| `searched.settled` | A recherché | Recherché |
| `searched.running` | Recherche | Recherche de |
| `searched_the_web.settled` | A recherché sur Internet | Recherché sur le web |
| `searched_the_web.running` | Recherche sur Internet | Recherche sur le web |
| `fetched.settled` | A récupéré | Récupéré |
| `fetched.running` | Récupère | Récupération de |
| `browsed.settled` | A parcouru | Parcouru |
| `browsed.running` | Parcourt | Parcours de |
| `listed_variables.settled` | A listé les variables | Listé les variables |
| `listed_variables.running` | Liste les variables | Liste des variables |
| `read_variable.settled` | A lu la variable | Lu la variable |
| `read_variable.running` | Lit la variable | Lecture de variable |
| `asked.settled` | A demandé | Demandé |
| `asked.running` | Demande | Demande de |
| `sent.settled` | A envoyé | Envoyé |
| `sent.running` | Envoie | Envoi de |
| `waited_for_jobs.settled` | A attendu les tâches | Attendu les tâches |
| `waited_for_jobs.running` | Attend les tâches | Attente des tâches |
| `deleted_team.settled` | A supprimé l’équipe | Supprimé l’équipe |
| `deleted_team.running` | Supprime l’équipe | Suppression d’équipe |
| `deleted_project.settled` | A supprimé le projet | Supprimé le projet |
| `deleted_project.running` | Supprime le projet | Suppression de projet |
| `received.settled` | A reçu | Reçu |
| `received.running` | Reçoit | Réception de |
| `delegated.settled` | A délégué | Délégué |
| `delegated.running` | Délègue | Délégation de |
| `listed_agents.settled` | A listé les agents | Listé les agents |
| `listed_agents.running` | Liste les agents | Liste des agents |
| `viewed_agent.settled` | A consulté l’agent | Consulté l’agent |
| `viewed_agent.running` | Consulte l’agent | Consultation d’agent |
| `searched_agents.settled` | A recherché des agents | Recherché des agents |
| `searched_agents.running` | Recherche des agents | Recherche d’agents |
| `installed_agent.settled` | A installé l’agent | Installé l’agent |
| `installed_agent.running` | Installe l’agent | Installation d’agent |
| `reset_agent.settled` | A réinitialisé l’agent | Réinitialisé l’agent |
| `reset_agent.running` | Réinitialise l’agent | Réinitialisation d’agent |
| `created_agent.settled` | A créé l’agent | Créé l’agent |
| `created_agent.running` | Crée l’agent | Création d’agent |
| `updated_agent.settled` | A actualisé l’agent | Mis à jour l’agent |
| `updated_agent.running` | Actualise l’agent | Mise à jour d’agent |
| `synced_agents.settled` | A synchronisé les agents | Synchronisé les agents |
| `synced_agents.running` | Synchronise les agents | Synchronisation des agents |
| `listed_teams.settled` | A listé les équipes | Listé les équipes |
| `listed_teams.running` | Liste les équipes | Liste des équipes |
| `viewed_team.settled` | A consulté l’équipe | Consulté l’équipe |
| `viewed_team.running` | Consulte l’équipe | Consultation d’équipe |
| `created_team.settled` | A créé l’équipe | Créé l’équipe |
| `created_team.running` | Crée l’équipe | Création d’équipe |
| `updated_team.settled` | A actualisé l’équipe | Mis à jour l’équipe |
| `updated_team.running` | Actualise l’équipe | Mise à jour d’équipe |
| `listed_subagents.settled` | A listé les sous-agents | Listé les sous-agents |
| `listed_subagents.running` | Liste les sous-agents | Liste des sous-agents |
| `peeked_at.settled` | A consulté | Inspecté |
| `peeked_at.running` | Consulte | Inspection de |
| `messaged.settled` | A écrit à | Envoyé à |
| `messaged.running` | Écrit à | Envoi à |
| `steered.settled` | A réorienté | Orienté |
| `steered.running` | Réoriente | Orientation de |
| `paused.settled` | A suspendu | Mis en pause |
| `paused.running` | Suspend | Mise en pause de |
| `cancelled.settled` | A annulé | Annulé |
| `cancelled.running` | Annule | Annulation de |
| `resumed.settled` | A repris | Repris |
| `resumed.running` | Reprend | Reprise de |
| `stored_secret.settled` | A enregistré le secret | Enregistré le secret |
| `stored_secret.running` | Enregistre le secret | Enregistrement de secret |
| `retrieved_secret.settled` | A récupéré le secret | Chargé le secret |
| `retrieved_secret.running` | Récupère le secret | Chargement de secret |
| `listed_secrets.settled` | A listé les secrets | Listé les secrets |
| `listed_secrets.running` | Liste les secrets | Liste des secrets |
| `described_secret.settled` | A décrit le secret | Décrit le secret |
| `described_secret.running` | Décrit le secret | Description de secret |
| `updated_secret.settled` | A actualisé le secret | Mis à jour le secret |
| `updated_secret.running` | Actualise le secret | Mise à jour de secret |
| `deleted_secret.settled` | A supprimé le secret | Supprimé le secret |
| `deleted_secret.running` | Supprime le secret | Suppression de secret |
| `listed_projects.settled` | A listé les projets | Listé les projets |
| `listed_projects.running` | Liste les projets | Liste des projets |
| `viewed_project.settled` | A consulté le projet | Consulté le projet |
| `viewed_project.running` | Consulte le projet | Consultation de projet |
| `created_project.settled` | A créé le projet | Créé le projet |
| `created_project.running` | Crée le projet | Création de projet |
| `updated_project.settled` | A actualisé le projet | Mis à jour le projet |
| `updated_project.running` | Actualise le projet | Mise à jour de projet |
| `linked_session_to.settled` | Session liée à | Lié la session à |
| `linked_session_to.running` | Lie la session à | Liaison de session à |
| `unlinked_session_from.settled` | Session dissociée de | Dissocié la session de |
| `unlinked_session_from.running` | Dissocie la session de | Dissociation de session de |
| `updated_milestone.settled` | A actualisé le jalon | Mis à jour le jalon |
| `updated_milestone.running` | Actualise le jalon | Mise à jour de jalon |
| `removed_milestone.settled` | A supprimé le jalon | Supprimé le jalon |
| `removed_milestone.running` | Supprime le jalon | Suppression de jalon |
| `read_todos.settled` | A lu les tâches | Lu les tâches |
| `read_todos.running` | Lit les tâches | Lecture de tâches |
| `updated_todos.settled` | A actualisé les tâches | Mis à jour les tâches |
| `updated_todos.running` | Actualise les tâches | Mise à jour de tâches |
| `scheduled.settled` | A planifié | Planifié |
| `scheduled.running` | Planifie | Planification de |
| `listed_wakes.settled` | A listé les réveils | Listé les réveils |
| `listed_wakes.running` | Liste les réveils | Liste des réveils |
| `cancelled_wake.settled` | A annulé le réveil | Annulé le réveil |
| `cancelled_wake.running` | Annule le réveil | Annulation de réveil |
| `listed_jobs.settled` | A listé les tâches | Listé les tâches |
| `listed_jobs.running` | Liste les tâches | Liste des tâches |
| `cancelled_job.settled` | A annulé la tâche | Annulé la tâche |
| `cancelled_job.running` | Annule la tâche | Annulation de tâche |
| `checked_network_status.settled` | A vérifié le réseau | Vérifié l’état du réseau |
| `checked_network_status.running` | Vérifie le réseau | Vérification d’état du réseau |
| `listed_networks.settled` | A listé les réseaux | Listé les réseaux |
| `listed_networks.running` | Liste les réseaux | Liste des réseaux |
| `viewed_network.settled` | A consulté le réseau | Consulté le réseau |
| `viewed_network.running` | Consulte le réseau | Consultation de réseau |
| `listed_network_peers.settled` | A listé les pairs | Listé les appareils réseau |
| `listed_network_peers.running` | Liste les pairs | Liste des appareils réseau |
| `read_network_log.settled` | Journal réseau lu | Lu le journal réseau |
| `read_network_log.running` | Lit le journal réseau | Lecture du journal réseau |
| `diagnosed_network.settled` | A diagnostiqué le réseau | Diagnostiqué le réseau |
| `diagnosed_network.running` | Diagnostique le réseau | Diagnostic de réseau |
| `created_network.settled` | A créé le réseau | Créé le réseau |
| `created_network.running` | Crée le réseau | Création de réseau |
| `invited_device.settled` | A invité l’appareil | Invité l’appareil |
| `invited_device.running` | Invite l’appareil | Invitation d’appareil |
| `joined_network.settled` | A rejoint le réseau | Connecté au réseau |
| `joined_network.running` | Rejoint le réseau | Connexion au réseau |
| `removed_device.settled` | A retiré l’appareil | Retiré l’appareil |
| `removed_device.running` | Retire l’appareil | Retrait d’appareil |
| `left_network.settled` | A quitté le réseau | Quitté le réseau |
| `left_network.running` | Quitte le réseau | Départ du réseau |
| `raised_panic.settled` | A déclenché l’alerte d’urgence | Révoqué d’urgence |
| `raised_panic.running` | Déclenche l’alerte d’urgence | Révocation d’urgence de |
| `listed_consoles.settled` | A listé les consoles | Listé les consoles |
| `listed_consoles.running` | Liste les consoles | Liste des consoles |
| `opened_console.settled` | A ouvert la console | Ouvert la console |
| `opened_console.running` | Ouvre la console | Ouverture de console |
| `checked_console.settled` | A vérifié la console | Vérifié la console |
| `checked_console.running` | Vérifie la console | Vérification de console |
| `read_console.settled` | A lu la console | Lu la console |
| `read_console.running` | Lit la console | Lecture de console |
| `captured_console.settled` | A capturé la console | Capturé l’écran de console |
| `captured_console.running` | Capture la console | Capture d’écran de console |
| `typed_in_console.settled` | A saisi en console | Saisi dans la console |
| `typed_in_console.running` | Saisit en console | Saisie dans la console |
| `sent_keys.settled` | A envoyé des touches | Envoyé les touches |
| `sent_keys.running` | Envoie des touches | Envoi des touches |
| `resized_console.settled` | A redimensionné la console | Redimensionné la console |
| `resized_console.running` | Redimensionne la console | Redimensionnement de console |
| `updated_secure_input.settled` | Saisie sécurisée actualisée | Mis à jour la saisie sécurisée |
| `updated_secure_input.running` | Actualise la saisie sécurisée | Mise à jour de saisie sécurisée |
| `closed_console.settled` | A fermé la console | Fermé la console |
| `closed_console.running` | Ferme la console | Fermeture de console |
| `found_definition.settled` | A trouvé la définition | Trouvé la définition |
| `found_definition.running` | Trouve la définition | Recherche de définition |
| `found_references.settled` | A trouvé les références | Trouvé les références |
| `found_references.running` | Trouve les références | Recherche de références |
| `listed_symbols.settled` | A listé les symboles | Listé les symboles |
| `listed_symbols.running` | Liste les symboles | Liste des symboles |
| `previewed_rename.settled` | A prévisualisé le renommage | Prévisualisé le renommage |
| `previewed_rename.running` | Prévisualise le renommage | Prévisualisation du renommage |
| `listed_sessions.settled` | A listé les sessions | Listé les sessions |
| `listed_sessions.running` | Liste les sessions | Liste des sessions |
| `viewed_session.settled` | A consulté la session | Consulté la session |
| `viewed_session.running` | Consulte la session | Consultation de session |
| `spawned_session.settled` | A lancé la session | Lancé la session |
| `spawned_session.running` | Lance la session | Lancement de session |
| `resumed_session.settled` | A repris la session | Repris la session |
| `resumed_session.running` | Reprend la session | Reprise de session |
| `stopped_session.settled` | A arrêté la session | Arrêté la session |
| `stopped_session.running` | Arrête la session | Arrêt de session |
| `peeked_at_session.settled` | A consulté la session | Inspecté la session |
| `peeked_at_session.running` | Consulte la session | Inspection de session |

Final `fr.v2.json` SHA-256: `3d49443f1be0e74ef8928b3a6df219457d564810af953fb6af89bc758c03d5a4`.
