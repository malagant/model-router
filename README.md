# model-router

Ein Mod für Claude Code, der jede Anfrage automatisch an das passende Modell schickt
(Haiku 5.5, Sonnet 5.5, Opus 5.5 oder Fable 5.2) und die Kosten mit den anderen Modellen vergleicht.

## Was er macht

- **Auswahl:** Kurze, einfache Anfragen gehen an Haiku. Code und Fehlermeldungen gehen an Sonnet.
  Komplexe Aufgaben wie Architektur, Refactoring, Debugging oder Analyse gehen an Opus. Fable gibt es nur,
  wenn du es ausdrücklich verlangst. Die Auswahl läuft lokal am Text und kostet nichts.
- **Anzeige:** Eine Zeile über dem Prompt zeigt das gewählte Modell, den Grund, die Kosten der letzten
  Anfrage und der Session. Daneben steht, was Opus gekostet hätte.
- **Vergleich:** `/router` öffnet ein Panel mit den tatsächlichen Kosten und den Kosten für „immer Haiku / Sonnet / Opus / Fable“.

## Installation

Im Prompt einer Terminal-Session:

```bash
/plugin install model-router --marketplace malagant/model-router
```

Oder in der Shell:

```bash
claude plugin install model-router --marketplace malagant/model-router
```

## Befehle

| Befehl | Wirkung |
| --- | --- |
| `/router` | Öffnet den Kostenvergleich |
| `/router auto` | Automatische Auswahl (Standard) |
| `/router off` | Router aus, das Session-Modell bleibt |
| `/router haiku`, `sonnet`, `opus`, `fable` | Fest auf ein Modell setzen |
| `/router reset` | Zähler zurücksetzen |

## Hinweise

- **Kosten sind eine Schätzung.** Der Vergleich rechnet dieselben Token-Zahlen mit den Listenpreisen der
  anderen Modelle in USD. Ein anderes Modell hätte anders lang geantwortet.
- **Modellwechsel kosten Cache.** Bei jedem Wechsel verliert der Prompt-Cache seine Gültigkeit.
- **Mit Abo** (Pro, Max) wird nicht pro Token abgerechnet. Die Beträge sind dann nur ein Richtwert.
- **Preise** stehen in `hooks/register.tsx` oben und lassen sich dort anpassen.

## Entwicklung

```bash
claude plugin validate .
claude plugin test .
```

## Lizenz

MIT, siehe [LICENSE](LICENSE).
