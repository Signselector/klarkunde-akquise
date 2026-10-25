# Caller workspace: implementation and backend handoff

Implemented in the live authenticated routes, using the existing Signselector theme and 3D icons. The appointment calendar route is unchanged.

- Caller navigation: Dashboard, Offene Leads, Rückrufe, Abgeschlossene Leads, Meine Kunden, existing Termine link. Administrative navigation remains available outside caller view.
- Dashboard: server-provided personal daily results; clearly labeled as covering all countries because get_dashboard has no country argument. Quality, contributed leads, average, ranking and rewards have explicit unavailable states, without fabricated scores.
- Open first contacts: open leads with zero previous attempts; the existing reservation-based call workflow records outcomes. Previously attempted open leads remain available to the server's retry queue and appear under completed first contacts as Nicht erreicht. Changing the status filter deliberately allows inspecting other outcomes.
- Completed initial contacts: own last-touched leads in the selected country, grouped by existing outcome, including internally open/retryable leads with attempts. This is not a sale/won status. Callback contacts have their own page.
- Callbacks: own country-scoped list, date filtering, compact calendar, recurring refresh, explicit load/error states, and a global due notification that opens a separate customer overlay without unmounting the current call form. No browser notification permission or sound required.
- Customer records: existing appointment/production outcomes and contact/note/history dialog. CRM display labels are presented separately, never inferred from local call outcomes.

## Interfaces still required from backend owner

1. Claim a specific selected lead/callback atomically, with conflict handling and lease renewal. claim_next_lead(country) cannot target a row; all result entry therefore continues through the existing call queue. Do not bypass reservations with direct updates.
2. Outcomes for in Bearbeitung / Zukunftsprojekt / Logo ausstehend and their validated CRM mapping. Current record_call_outcome accepts not_reached, no_interest, callback, appointment and production only.
3. Customer deal read model: CRM stage ID, stage label, actual owner, sync state, authoritative allowed transitions and required note validation. The new country stage-mapping table supplies configuration only, not customer stage data or transition permissions.
4. Recruit / Veteran / Manager role definitions and server-enforced ownership/transition checks. Existing generated role enum is admin/caller/fulfilment. Frontend must not approximate access by role-name ranking.
5. All three authoritative won-stage IDs per country for Andere Prozente / Produktionsplanung / 0% Anzahlung. Do not guess from production configuration.
6. Quality metric, attributed lead count, agreed average definition, weekly caller ranking, points/reward approval. Include explicit date range and country scope. No frontend scoring formula.

## Verification

Typecheck, production build and existing Vitest suite, plus a regression test for reminder deduplication and preserving an unsaved working note while opening/closing the customer overlay. No production backend writes or migrations performed. Live role/CRM acceptance and browser/mobile visual review remain required before declaring full feature acceptance.
