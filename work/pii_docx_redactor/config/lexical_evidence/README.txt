DocScrub Lexical Pack v0.1

Purpose
-------
Curated deterministic lexical evidence lists for Candidate Quality.

Files and entry counts
----------------------
address_suffixes.txt: 386
calendar_abbreviations.txt: 51
common_abbreviations.txt: 127
contractions.txt: 122
honorifics_and_titles.txt: 70
interjections_and_casual.txt: 66
organization_suffixes.txt: 54
product_and_system_names_seed.txt: 24
professional_credentials.txt: 86

Normalization assumptions
-------------------------
- Lookups should be case-insensitive.
- Normalize Unicode with NFKC.
- Trim surrounding whitespace.
- Normalize curly apostrophes to straight apostrophes before lookup.
- Preserve the original candidate text for display and redaction.
- Treat membership as evidence, not an automatic final disposition.
- A candidate may legitimately match more than one list.

Important ambiguity notes
-------------------------
- Short calendar forms such as "mo", "tu", "we", "th", "fr", "sa", and "su" are intentionally included.
  They should be interpreted as calendar abbreviations only when document context supports that reading.
- Address suffixes such as "dr", "st", "ct", "pl", "way", and "run" overlap ordinary words, names, or titles.
  They should strengthen address evidence, not independently force an address classification.
- Credentials such as "ms", "ma", "pa", "do", and "pt" are highly context-sensitive.
- Organization suffixes and honorifics can overlap ordinary vocabulary.
- Product/system names are a seed list and should remain separately maintainable.

Recommended evidence buckets
----------------------------
Contraction
Calendar abbreviation
Common abbreviation
Interjection / casual expression
Organization suffix
Address suffix
Honorific / title
Professional credential
Product / system name

Version
-------
0.1
