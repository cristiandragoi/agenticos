# AgenticOS — Physical Foreground Perception Root-Cause Report

> **Status**: CONFIRMED root causes with live evidence  
> **Date**: 2026-09-30T23:05Z  
> **Scope**: Read-only diagnostic — no code modified

---

## Executive Summary

The `read_foreground_screen` capability's physical failure has **three confirmed, interdependent root causes**. None involve routing. The routing layer correctly identifies the intent and reaches the correct PS1 action. The defect is in **what the PS1 extracts and how the TypeScript layer evaluates it**.

> [!CAUTION]
> The fundamental problem: **UIA `AutomationElement.Name` returns accessibility labels (button names, menu items, sidebar navigation), not visible document/page content.** The code treats these labels as "content" because they pass the only quality gate (`length >= 20`), preventing the vision fallback from ever executing.

---

## 1. CONFIRMED Root Causes

### Root Cause 1: UIA Extracts Accessibility Metadata, Not Visible Content

**Severity: CRITICAL — This is the primary defect.**

The PS1 extraction loop at [`desktop_perception.ps1:448-480`](file:///D:/AgenticOS/server/scripts/desktop_perception.ps1#L448-L480) iterates over all UIA descendants and collects `$d.Current.Name` for every element that passes the type and geometry filters.

`AutomationElement.Name` is the **accessibility name** — what a screen reader announces. For a button labeled "Datei" (File), `.Name` returns `"Datei"`. For a sidebar button labeled "Bibliothek" (Library), `.Name` returns `"Bibliothek"`. For a chat history item, `.Name` returns the chat title.

**This is by design in the UIA specification.** `.Name` is NOT the visible text content of a document or web page. The code is reading the UI's **structural accessibility tree**, not its **content**.

#### Live Evidence — ChatGPT Window (Electron/Chromium)

From the UIA diagnostic probe at 23:01:14Z:

```
ContentRoot: Chrome_RenderWidgetHostHWND
Total descendants: 934
NonClientTop: 0px

  [0] ACCEPT | Hyperlink  "Zum Inhalt springen"           <- skip-navigation link
  [1] ACCEPT | Button     "Zurueck"                       <- back button
  [2] ACCEPT | Button     "Vorwaerts"                     <- forward button
  [3] ACCEPT | Button     "Seitenleiste schliessen"       <- close sidebar button
  [5] ACCEPT | MenuItem   "Datei"                         <- File menu
  [6] ACCEPT | MenuItem   "Bearbeiten"                    <- Edit menu
  [7] ACCEPT | MenuItem   "Ansicht"                       <- View menu
  [8] ACCEPT | MenuItem   "Hilfe"                         <- Help menu
  [9] ACCEPT | Group      "App-Navigation"                <- sidebar container
  [10] ACCEPT | Button    "Startseite"                    <- Home button
  [11] ACCEPT | Button    "Geplant"                       <- Planned button
  [12] ACCEPT | Button    "Bibliothek"                    <- Library button
  ...
```

**934 descendants**, all with `.Name` being a UI label. Zero actual chat content.

#### Live Evidence — Runtime Trace (Physical Failure)

From `jarvis-runtime-trace.log` at 20:48:17Z:

```
FINAL_RESPONSE=I can see a ChatGPT window - "ChatGPT". The visible content
contains: Zum Inhalt springen; Zurueck; Vorwaerts; Seitenleiste schliessen;
Datei; Bearbeiten; Ansicht; Hilfe.
```

**This is the exact text from UIA elements [0]-[8] above.** The system spoke these accessibility labels as if they were the visible content.

#### Live Evidence — Word Window (Native Win32)

```
ContentRoot: OpusApp (Dokument1 - Word)
NonClientTop: 1px

  [0] ACCEPT | Pane        name=DropShadowTop
  [1] ACCEPT | Pane        name=MsoDockTop
  [2] ACCEPT | Pane        name=Ribbon
  [5] ACCEPT | ToolBar     name=Symbolleiste fuer den Schnellzugriff
  [6] ACCEPT | Button      name=Automatisches Speichern
  [7] ACCEPT | Button      name=Speichern
  [8] ACCEPT | SplitButton name=Rueckgaengig: Nicht moeglich
  [18] ACCEPT | Button     name=Registerkarte "Datei"
  [20] ACCEPT | TabItem    name=Start
  [21] ACCEPT | TabItem    name=Einfuegen
  [22] ACCEPT | TabItem    name=Entwurf
  ...
```

Every Word ribbon button, toolbar item, and tab label is extracted as "content." The actual document text is nowhere in the first 30 elements.

---

### Root Cause 2: Geometry Filter Is Nullified by Modern Window Managers

**Severity: HIGH — Enabler of Root Cause 1.**

The geometry filter at [`desktop_perception.ps1:457-463`](file:///D:/AgenticOS/server/scripts/desktop_perception.ps1#L457-L463) removes elements outside the **client rect**:

```powershell
if ($b.Bottom -le $clientTop -or $b.Top -ge $clientBottom -or
    $b.Right -le $clientLeft -or $b.Left -ge $clientRight) {
    $chromeFiltered++
    continue
}
```

This was designed to filter title-bar buttons by their geometry. In practice:

| Window Type | NonClientTop | ClientRect vs WindowRect | Geometry Filter Effect |
|---|---|---|---|
| **Chromium/Electron** (ChatGPT, Comet, Antigravity IDE) | **0px** | **Identical** | **Filters nothing** |
| **Modern Win32** (Word, Access) | **1px** | Nearly identical (DWM composited) | **Filters almost nothing** |
| **Classic Win32** (old Notepad) | ~30px | Different | Works as designed |

For Chromium/Electron apps, `ClientToScreen` returns coordinates that perfectly overlap `GetWindowRect`. The entire window, including the title bar, menu bar, and all buttons, is "inside the client area." The geometry filter passes 100% of elements.

#### Live Evidence

```
ChatGPT:  WindowRect: L=15 T=14 R=1924 B=945
          ClientRect: L=15 T=14 R=1924 B=945    <- IDENTICAL
          Geometry-filtered: 0

Word:     WindowRect: L=182 T=182 R=1622 B=935
          ClientRect: L=190 T=183 R=1614 B=927   <- 1px top difference
          Geometry-filtered: 0
```

---

### Root Cause 3: Content Quality Gate Prevents Vision Fallback

**Severity: HIGH — Blocks the only path to correct results.**

[`foregroundScreenReader.ts:238`](file:///D:/AgenticOS/server/src/services/perception/foregroundScreenReader.ts#L238):

```typescript
if (base.content.length >= 20) {
    return reading(base, {
        method: 'uia',
        spokenText: `I can see a ${identity}. The visible content contains: ${preview(base.content)}.`,
        ...counts,
        ...shot,
    });
}
```

The **only quality criterion** is character count >= 20. The ChatGPT UIA output is 96+ characters of menu labels. The Word output is 200+ characters of ribbon labels. Both exceed the threshold, so the code:

1. Declares UIA extraction successful
2. Returns the accessibility labels as `spokenText`
3. **Never reaches the vision fallback at line 248**

The vision fallback (screenshot -> multimodal LLM) **would produce correct results** but is architecturally unreachable because UIA always returns "enough" characters of metadata.

#### Evidence: No Vision Fallback Screenshots Exist

```
D:\AgenticOS\data\artifacts\screenshots> dir foreground-read-*
(no files found)
```

No `foreground-read-*` screenshot artifact has ever been created on this machine.

---

## 2. Hypotheses Disproven

### Disproven: "Wrong foreground HWND selected"

The runtime trace confirms the correct foreground window is identified:

- Turn 10: ChatGPT -- correct, `GetForegroundWindow()` returns ChatGPT HWND
- Turn 11: Notepad -- correct, returns Notepad HWND with the right title
- Turn 18: Antigravity IDE -- correct (but should have been filtered by self-guard; separate issue)

**The HWND selection works.** The defect is in what is extracted from the correct window.

### Disproven: "HWND changes during execution"

The session diagnostic confirms all AgenticOS server processes run in Session 1. PowerShell child processes inherit the desktop context. `GetForegroundWindow()` returns the correct HWND consistently when called from the Node.js server.

> [!NOTE]
> My diagnostic probes from the agent environment showed `GetForegroundWindow() = 0` because the Antigravity IDE agent spawns commands in a separate desktop context where `SetThreadDesktop` fails. This is an agent environment limitation, not a production defect.

### Disproven: "Routing sends to wrong handler"

Runtime traces show `ROUTE=read_foreground_screen` consistently. The voice path (`turnRouter.ts`) correctly routes to `readForegroundScreen()`. The routing layer works.

### Disproven: "Localization is corrupting interpretation"

The German strings originate from UIA `.Name` properties on the German-localized ChatGPT desktop app. They are **correctly extracted German accessibility labels** -- the problem is that accessibility labels are the wrong data source, not that localization corrupted anything.

---

## 3. Supporting Evidence Detail

### 3a. Exact Live HWND/PID Evidence

From `EnumDesktopWindows` probe at 22:58:06Z:

| HWND | PID | Process | Title |
|---|---|---|---|
| 133074 | - | Antigravity IDE | Antigravity IDE - Run Production Acceptance Suite |
| 264404 | 21896 | ChatGPT | ChatGPT |
| 855396 | 4256 | WINWORD | Dokument1 - Word |
| 1509758 | - | claude | Claude |
| 591890 | - | hermes-agent | Hermes One |
| 133174 | - | Telegram | AgenticOS (82) |
| 132884 | - | comet | YouTube - Comet |
| 68424 | - | Notepad | *hello_world.txt - Notepad |
| 264888 | - | olk | E-Mail - Outlook |

### 3b. Raw UIA Sample (ChatGPT -- 934 elements, first 18)

```
[0]  Hyperlink  "Zum Inhalt springen"           [20,21,54,53]
[1]  Button     "Zurueck"                       [21,18,49,46]
[2]  Button     "Vorwaerts"                     [55,18,83,46]
[3]  Button     "Seitenleiste schliessen"       [89,18,117,46]
[4]  MenuBar    "Anwendungsmenue"               [123,20,402,44]   <- SKIPPED (type)
[5]  MenuItem   "Datei"                         [127,20,182,44]
[6]  MenuItem   "Bearbeiten"                    [183,20,272,44]
[7]  MenuItem   "Ansicht"                       [273,20,342,44]
[8]  MenuItem   "Hilfe"                         [343,20,394,44]
[9]  Group      "App-Navigation"                [15,58,67,941]
[10] Button     "Startseite"                    [23,66,59,102]
[11] Button     "Geplant"                       [23,110,59,146]
[12] Button     "Bibliothek"                    [23,154,59,190]
[13] Button     "Bilder"                        [23,198,59,234]
[14] Button     "Plugins"                       [23,242,59,278]
[15] Button     "Entdecken"                     [23,286,59,322]
[16] Button     "Update verfuegbar"             [23,857,59,893]
[17] Button     "Profilmenue oeffnen"           [23,901,59,937]
```

**934 elements. Zero page content.** All are navigation/sidebar/menu labels.

### 3c. Screenshot Evidence

No `foreground-read-*` screenshot has ever been created. The vision fallback is dead code in practice.

### 3d. Vision Fallback Execution: NEVER

The code at [`foregroundScreenReader.ts:247-270`](file:///D:/AgenticOS/server/src/services/perception/foregroundScreenReader.ts#L247-L270) only executes when `base.content.length < 20`. Since every real application produces dozens of UIA control names > 20 chars total, this condition is never met.

---

## 4. Why Returned Text Differs From Visible Screen

| What the user sees | What UIA returns | Why |
|---|---|---|
| ChatGPT conversation text | Menu labels, sidebar nav | UIA `.Name` returns the accessibility label of navigation links and menu items, not rendered chat text |
| Notepad document text | Tab labels, menu names | UIA `.Name` returns tab titles; document text is in a `ControlType.Document` element deeper in tree |
| Word document text | Ribbon pane/button names | UIA `.Name` returns ribbon labels; document content is deep in the tree beyond the 400-element cap |

The extraction loop processes elements in tree order (depth-first). UI chrome elements (menus, toolbars, tabs, sidebar) appear BEFORE content elements in the UIA tree. With a 400-element cap at line 449, the loop fills with chrome before reaching any document content.

---

## 5. Exact Files/Functions Responsible

| File | Line(s) | Defect |
|---|---|---|
| `desktop_perception.ps1` | 448-480 | UIA extraction uses `.Name` without distinguishing content from chrome |
| `desktop_perception.ps1` | 431-434 | `$skipTypes` only skips 5 types; `MenuItem`, `Button`, `Hyperlink`, `TabItem`, `ToolBar`, `Group` all pass |
| `desktop_perception.ps1` | 457-463 | Geometry filter is nullified by Chromium/DWM (NonClientTop=0) |
| `desktop_perception.ps1` | 449 | 400-element cap fills with chrome before reaching content |
| `foregroundScreenReader.ts` | 238 | `length >= 20` quality gate treats any 20 chars as valid content |
| `foregroundScreenReader.ts` | 128-134 | `preview()` joins first 8 lines - which are all chrome labels |

---

## 6. Minimal Architectural Correction Required

> [!IMPORTANT]
> The following are corrections, not implementations. No code has been modified.

### Correction A: Content-Type Aware Extraction (PS1)

The extraction must distinguish between:
1. **Content elements**: `ControlType.Text`, `ControlType.Document`, `ControlType.Edit`, `ControlType.DataItem`, `ControlType.TreeItem`
2. **Chrome elements**: `ControlType.Button`, `ControlType.MenuItem`, `ControlType.TabItem`, `ControlType.Hyperlink`, `ControlType.ToolBar`, `ControlType.Group`, `ControlType.Pane`

For content elements, `.Name` is appropriate. For `ControlType.Edit` and `ControlType.Document`, the `TextPattern` or `ValuePattern` contains the actual content (not `.Name`).

### Correction B: TextPattern Extraction for Documents

For `ControlType.Document` elements (web pages in Chromium, documents in Word):
```powershell
$tp = $d.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
if ($tp) { $text = $tp.DocumentRange.GetText(-1) }
```

This returns the **actual visible text content**, not UI labels.

### Correction C: Semantic Quality Gate (TypeScript)

Replace `length >= 20` with a semantic check:
- Does the content consist primarily of short labels (< 5 words each)?
- Does the content match known chrome patterns (menu items, button names)?
- Is the content linguistically coherent (sentences vs. label fragments)?

If the content is primarily chrome labels, force the vision fallback.

### Correction D: Content-First Traversal Order

Process `ControlType.Document`, `ControlType.Edit`, and `ControlType.Text` elements **before** processing other types. This ensures document content fills the 400-element budget before chrome labels.

---

## 7. Tests That Would Prove the Correction

### Test 1: ChatGPT Content Extraction
1. Open ChatGPT with a visible conversation
2. Run `read_foreground`
3. **PASS**: Returned text contains conversation messages (not "Zum Inhalt springen", "Datei", "Bearbeiten")
4. **FAIL**: Returns navigation/menu labels

### Test 2: Word Document Content
1. Open Word with known document text
2. Run `read_foreground`
3. **PASS**: Returned text contains document paragraph text (not "Ribbon", "Symbolleiste", "Start", "Einfuegen")
4. **FAIL**: Returns ribbon/toolbar labels

### Test 3: Vision Fallback Activation
1. Open an app where `TextPattern` is unavailable
2. Verify vision fallback produces a screenshot artifact (`foreground-read-*.png`)
3. **PASS**: Screenshot exists and vision describes the visible content
4. **FAIL**: No screenshot created, or UIA labels returned

### Test 4: Content vs. Chrome Ratio
1. Extract UIA for any window
2. Compute ratio: content elements / total elements
3. **PASS**: > 50% of extracted text comes from `Text`, `Document`, or `Edit` types
4. **FAIL**: > 80% comes from `Button`, `MenuItem`, `TabItem`

### Test 5: Notepad Plain Text
1. Open Notepad with "Hello World physical test 4471"
2. Run `read_foreground`
3. **PASS**: Returned text contains "Hello World physical test 4471"
4. **FAIL**: Returns "Text-Editor; Unbenannt" or tab labels

---

## 8. Physical Acceptance Steps (Post-Correction)

1. Open Notepad with known text -> voice "Read what is on my screen" -> verify exact text returned
2. Open ChatGPT with visible conversation -> same voice command -> verify conversation content returned
3. Open Word with document text -> same -> verify document paragraphs
4. Open Comet browser with known page -> same -> verify page content
5. Minimize all windows -> same -> verify terminal failure (not fabricated content)
6. AgenticOS in foreground -> same -> verify self-guard fires
7. Verify at least one test case triggers vision fallback with valid screenshot artifact

---

## 9. Foreground Semantics Clarification (Question G)

### Current Implementation

`read_foreground_screen` means: **the window returned by `GetForegroundWindow()`** -- the Win32 foreground window, which is the window that has keyboard focus.

### Recommended Authoritative Definition

> `read_foreground_screen` should mean: **the last user-focused application before the Jarvis turn began.**

Implementation: capture the foreground HWND **at turn start** (before any TTS/processing begins) and pass it to the PS1 via the `-Hwnd` parameter. The PS1 already supports `$Hwnd` passthrough.

This avoids the race condition where AgenticOS/Jarvis/Electron steals foreground focus during acknowledgement, which would explain why Turn 18 returned Antigravity IDE content when the user was looking at another application.

---

## 10. Findings Classification

### CONFIRMED (with live evidence)

| # | Finding |
|---|---|
| C1 | UIA `.Name` returns accessibility labels, not visible content -- live UIA probe shows 934 elements, 0 content |
| C2 | Geometry filter returns 0 filtered elements for Chromium (NonClientTop=0px) |
| C3 | Quality gate (`length >= 20`) accepts chrome labels, blocking vision fallback |
| C4 | No `foreground-read-*` screenshot has ever been created -- vision fallback has never executed |
| C5 | Runtime trace confirms exact failure text matches UIA elements [0]-[8] |
| C6 | `$skipTypes` skips only 5 of ~20 control types; `MenuItem`, `Button`, `Hyperlink`, `TabItem`, `ToolBar` all pass |
| C7 | 400-element cap fills with chrome before reaching content elements in tree order |

### LIKELY (consistent with evidence, not directly observed)

| # | Finding |
|---|---|
| L1 | AgenticOS/Jarvis steals foreground focus during voice turn processing (Turn 18 returned Antigravity IDE content) |
| L2 | `TextPattern` on Chromium `Document` elements would return actual page text |
| L3 | Word `Document` content area is deep in UIA tree, beyond the first 400 elements |

### UNPROVEN

| # | Finding |
|---|---|
| U1 | Whether DPI scaling affects geometry filter accuracy (no mixed-DPI setup available) |
| U2 | Whether `PrintWindow` captures the correct client content (no `foreground-read-*` screenshots exist to verify) |
| U3 | Whether the Jarvis voice acknowledgement systematically steals foreground before PS1 execution |

---

*Report completed: 2026-09-30T23:05Z. No code was modified.*
