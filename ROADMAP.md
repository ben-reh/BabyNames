# BabyNames Roadmap

## Branding
- [ ] App name
- [ ] App logo

## App Features

### Onboarding flow
- [x] Partner pairing / invite flow (create list + share code, or join with code)
- [x] Initial preference setup (sex filter — girl / boy / both)
- [x] Name style quiz to seed initial taste vector (5 forced-choice pairs across 10 style clusters)
- [x] Favorite names import (search, paste from Notes/clipboard, or free-text entry)
- [x] How it works explainer
- [x] Popularity preferences in onboarding
- [ ] Name style quiz improvements (more pairs, better cluster coverage)

### Swipe card improvements
- [x] 2025 SSA rank
- [x] Origin / meaning (origin shown; meaning not in data model)
- [x] Name gender split for 2025
- [ ] Sibling name compatibility indicator
- [ ] Name meaning in details card

### Name tags
- [ ] User-defined tags on liked names (e.g. "top pick", "maybe", "love the sound", "too popular")
- [ ] Filter and sort My Lists by tag
- [ ] Partner can see each other's tags to understand why a name was liked

### AI chat feature & list generator
- [ ] Natural language name exploration for list generation("find me something like Clementine but shorter")
- [ ] Answer questions about a name (meaning, history, pronunciation)
- [ ] Analysis of names the user has liked and suggestions based on patterns

---

## Recommendation Model

### High priority
- [ ] **Collaborative filtering** — co-like signals once real users exist; highest single-improvement lever
- [ ] **Multi-vector taste representation** — cluster liked names into 2–3 style groups instead of single average; handles bimodal preferences (user who likes both biblical and nature names)
- [ ] **Rarity preference detection** — detect from swipe history whether user prefers rare vs. common names; adjust minimum count threshold accordingly
- [x] **Partner taste blending** — blend both partners' taste vectors (`0.5 * user + 0.5 * partner`) for ANN query instead of just priority-sorting partner-liked names

### Medium priority
- [ ] **Trend velocity feature** — add 3–5 year popularity slope from RDS `name_popularity` data; distinguishes "peaked 2020, now declining" from "peaked 2020, still rising"
- [x] **Long-tail exploration** — rare names (Melrose, Dawn, Rue) have vectors but never surface because a generic taste vector points toward popular names in ANN search; add a diversity/exploration component that injects long-tail names weighted by origin/style fit, independent of similarity score
- [x] **Skip signal** — capture quick-swipe-past as implicit dislike; improve taste vector quality

### Lower priority
- [ ] **Sibling name compatibility** — factor in existing children's names for families on their second+ child
- [ ] **Origin language-family grouping** — replace flat one-hot with language family hierarchy (Romance / Germanic / Celtic / Biblical / etc.)
- [ ] **Fine-tuned embedding model** — train on baby name co-like data for better semantic separation than general-purpose text-embedding-3-small

---

## Infrastructure
- [x] Deploy recommendations and swipe Lambda functions (handlers written, not yet wired to API Gateway)
- [ ] Cognito auth integration (guest browsing works; account required for swipes/lists)
- [ ] App Store submission
