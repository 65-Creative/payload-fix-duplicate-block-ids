# Projektregeln

## Risikogerecht prüfen und abschließen

- Bei PR-Arbeit die verfügbaren Skills `test-impact` für Wirkung und Prüfumfang
  sowie `pr-pruefen` für den Abschluss nutzen; beauftragte T3-Arbeit über
  `t3-dirigent` beim zuständigen Eigentümer halten.
- Für Laufzeitnachweise vorhandene projektlokale Verification-Skills verwenden;
  `verify-project` hilft beim Einrichten. `agent-codebase-gardener` nur bei
  belegten wiederkehrenden Fehlern, nicht als zusätzliche Pflichtprüfung.
- Datenschutz/DSGVO, Accessibility und Crawlbarkeit einschließlich SSR/HTML am
  bestehenden Kundenprofil prüfen oder Nichtbetroffenheit begründen.
  Ungeprüft ist nicht bestanden; technische Tests sind keine Konformitätsgarantie.
- Reine Design-/Textkorrekturen klein und risikogerecht prüfen. Preise, Verhalten,
  Rechte und Datenflüsse sind nicht allein wegen Dateityp oder Wortlaut risikoarm.
  Kritisches erfordert menschlichen manuellen Test und konkrete Mergefreigabe.
- Gültige Nachweise nach dem Projektvertrag wiederverwenden. Neue Prüfungen brauchen
  geänderten Inhalt, relevante Integration oder ein belastbares Finding. Keine
  unveränderten Volltests, künstlichen Commits oder blinden Bot-Wiederholungen.
- Score und Skills erteilen keine Mergeberechtigung. Bestehende passende Freigaben
  nutzen; Pflichtchecks, Projektregeln und dortige Ausnahmen bleiben verbindlich.
  Fehlende Skills offen benennen und diese Grundsätze unmittelbar anwenden.

Vorhandene technische Lifecycle-/CI-/Veröffentlichungsgates, Pflichtrollen und
Snapshotbindungen bleiben unverändert verbindlich. Fehlende Kundenanforderungen
bleiben offen; kein Profil und keine Konformitätsabnahme erfinden.
