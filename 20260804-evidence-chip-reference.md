# Evidence Chips — Complete Reference

**Date:** 2026-08-04
**Source of truth:** `src/engines/explanation/explanation-dictionary.data.ts`
(chip labels) and `src/engines/quality/quality-dictionaries.data.ts`
(`EVIDENCE_WEIGHTS` — the sign and strength) plus `scoring.ts` (what fires
each rule).

**55 chips.** The sign shown in the panel is not a property of the label —
it comes from the rule's weight. Positive means "this pushes the score
toward *yes, it is what it was detected as*"; negative means the opposite.
The weight is the number of points the rule contributes to the 0–100
likelihood.

Sorted by strength within each group, because that is the useful order: the
top of each table is what actually moves a decision.

---

## Positive — pushes toward "yes, this is it" (17)

| Chip | Wt | Why it fires |
| --- | ---: | --- |
| Structured non-name value | +70 | The item was matched by a *non-person* detector — email, phone, ID. Strongly positive because it confirms the thing IS the (non-person) entity it was detected as. Fires whenever `detectedType !== "person"`. |
| Surname-first name structure | +50 | Reads as `Goodloe, Andrew` — the comma-inverted form used in rosters and directories. The single strongest *person* signal, because almost nothing else uses that shape. |
| Initials with surname | +42 | `A. Goodloe`, `J. R. Smith` — an initial followed by a surname. |
| Nearby title | +40 | A title or honorific sits *next to* the item — `Dr. ___`, `Dean ___`. Note this is about the surroundings, not the item itself. |
| Strong name structure | +35 | The item itself has the shape of a full personal name: two or three capitalised word-parts in given-name/surname order, no dictionary words doing the work. This is the general "looks like a name" rule; the two above are its more specific, higher-confidence cousins. |
| Email evidence | +32 | The item appears inside or adjacent to an email address — `agoodloe@…`. People's names are what email local-parts are usually made of. |
| Known first name | +28 | Matches the known-given-name list. |
| Ambiguous lexical token | +28 | A word that is *both* an ordinary word and a common name — Grace, Mark, Will, Hope. Positive because the name reading has to be considered; this is the rule that makes such items land in review rather than being auto-dismissed. |
| Known surname | +26 | Matches the known-surname list. |
| Signature or email header | +22 | The item sits in a signature block or a `From:`/`To:`/`Cc:` header — structurally a place where names live. |
| Known name token | +20 | Not a whole known name, but one of its parts is. |
| Repeated occurrence *(saturated)* | +14 | Appears many times throughout the document. Repetition is mildly positive because a document that names a person tends to name them repeatedly. |
| Single reviewable token | +12 | One word, with nothing negative found against it. Not evidence *for* a name so much as the absence of evidence against — enough to warrant a human look. |
| Repeated occurrence *(moderate)* | +9 | Appears repeatedly. Same reasoning, weaker. |
| Single-name candidate | +8 | Could be a standalone name reference — a lone capitalised word used the way a name is used. |
| Honorific or title | +6 | The item matches title vocabulary (`Dr`, `Dean`, `Prof`). Weakly positive because such strings usually travel with a name. **Worth a look:** this being positive at all is arguable — see Notes. |
| Repeated occurrence *(small)* | +4 | Appears more than once. |

---

## Negative — pushes toward "no, this isn't it" (37)

| Chip | Wt | Why it fires |
| --- | ---: | --- |
| Common language token | −40 | Matches the *expanded* common-word list — the broadest ordinary-vocabulary check. The single strongest negative. |
| No alphabetic tokens | −35 | Contains no letters at all. Whatever it is, it isn't a name. |
| OCR artifact | −35 | Bears the marks of scanning or extraction noise — broken characters, impossible letter runs. |
| Pronoun or determiner | −35 | `He`, `They`, `The`, `This`. Capitalised at a sentence start and mistaken for a name. |
| Greeting or courtesy | −32 | `Dear`, `Regards`, `Sincerely`, `Thanks`. Very common false positive in letters and email. |
| Administrative phrase | −30 | Matches a known administrative stock phrase. |
| Common English word | −28 | An everyday dictionary word. |
| Unusual capitalization | −28 | Capitalisation no real name would have — `mcDONALD`, `ANdrew`, interior capitals in the wrong places. |
| Very short token | −28 | A very short standalone item — one or two characters. Too little to be a name. |
| Common verb | −24 | `Will`, `Mark`, `Grant`, `Bill` used as verbs. |
| Institution term | −24 | Matches institutional vocabulary — `University`, `Campus`, `Registrar`. |
| Sentence fragment | −24 | The item looks like a clipped piece of a sentence rather than a noun phrase. |
| Calendar term | −22 | `Monday`, `March`, `Spring`. |
| Department or organization | −22 | Matches department/org vocabulary — `Records Office`, `Enrollment Services`. |
| Product or system | −22 | Matches product/system vocabulary — `Canvas`, `Google Drive`, `PeopleSoft`. |
| Academic term | −22 | Seasonal or academic vocabulary — `Fall Term`, `Semester`. |
| Address suffix | −18 | `Street`, `Avenue`, `Suite`. |
| Common-word phrase | −18 | *Every* word in a multi-word item is an ordinary dictionary word. Stronger than any single word being common. |
| Document structure term | −18 | `Appendix`, `Section`, `Attachment`, `Table`. |
| Grammatical phrase | −18 | Has the grammatical shape of a phrase — article + noun, verb + object — rather than a name. |
| Institution acronym | −18 | Matches known institutional acronym vocabulary — `CSU`, `ITS`. |
| Casual expression | −18 | Interjections and casual usage — `Oh`, `Well`, `Hey`. |
| Abbreviation | −16 | Commonly used as an abbreviation. |
| Sentence fragment word | −16 | Contains vocabulary typical of sentence fragments. |
| Legal or administrative term | −14 | `Pursuant`, `Whereas`, `Policy`. |
| Calendar abbreviation | −12 | `Mon`, `Jan`, `Q3`. |
| Heading context | −12 | Appears in a heading. Headings are title-case, which manufactures name-looking strings; the context is evidence against. |
| Unknown lowercase token | −12 | Unrecognised and lowercase. Names are capitalised, so lowercase counts against. |
| Common abbreviation | −10 | Matches the common-abbreviation list. |
| Contraction | −10 | `I'd`, `Canvas, I'd` — apostrophe forms mis-split into name-looking pieces. |
| Organization suffix | −10 | `Inc`, `LLC`, `Dept`. |
| Unknown token | −10 | Not recognised by any deterministic rule. Mildly negative as a default. |
| Likely acronym | −8 | Has the *shape* of an acronym — all caps, short, no vowel pattern — even if not in the acronym list. |
| Weak name structure | −5 | Name-shaped, but only loosely — the structure test passed at low strength. |
| No positive person evidence | −5 | Nothing in the positive column fired at all. A summary rule, not an observation about the text. |
| Professional credential | −4 | `PhD`, `MD`, `CPA`. Weakly negative: a credential travels with a name but is not one. |
| Single occurrence | −4 | Appears exactly once. Mildly negative — a person referenced in a document is usually referenced more than once. |

---

## Neutral (1)

| Chip | Wt | Why it fires |
| --- | ---: | --- |
| Unknown capitalized token | 0 | Starts with a capital and matches no dictionary, positive or negative. Genuinely undecided — the rule exists to say "we looked and found nothing", which is different from having found nothing to look at. |

---

## Notes worth acting on

**1. Three different rules render as the same chip.** `small-frequency-bonus`
(+4), `moderate-frequency-bonus` (+9) and `frequency-saturated` (+14) all
display as **"Repeated occurrence"**. A reviewer seeing that chip cannot
tell whether it contributed 4 points or 14. The `standard` strings do
distinguish them ("more than once" / "repeatedly" / "repeatedly
throughout"), so the information exists and only the short register
collapses it. Cheap fix if it matters: give them distinct short labels.

**2. "Honorific or title" being positive (+6) is arguable.** The rule fires
when the item *itself* matches title vocabulary — so a bare `Dean` scores
slightly toward being a person. That is probably intended (titles usually
appear attached to names) but it is the one weight in the table whose sign
I would want confirmed against the Python oracle before trusting it. Note
that `nearby-title` (+40), for a title *beside* the item, is unambiguous
and doing most of the real work.

**3. "Token" appears in five chip labels** — Known name token, Single
reviewable token, Very short token, Ambiguous lexical token, Common
language token, Unknown capitalized/lowercase token. It is the one word in
this vocabulary that means nothing outside engineering. If you ever do the
plain-language pass, this is the highest-value single substitution: *token*
→ *word*.

**4. Copy-paste has no separator.** The chips are laid out with CSS `gap`,
so selecting and copying them yields `+Strong name structure−Single
occurrence` with nothing between — which is how you quoted it. If people
will paste these into tickets or email, the chips need a real character
(a middle dot, or a comma) rather than whitespace-by-layout. Small fix,
easy to miss until someone pastes one.
