# BabyNames Roadmap

## Branding
- [ ] App name
- [ ] App logo

## App Features

### Onboarding flow
- [ ] Partner pairing / invite flow
- [ ] Initial preference setup (sex filter, origin preferences)
- [ ] Name style quiz to seed initial taste vector

### Swipe card improvements
- [ ] 2025 SSA rank
- [ ] Origin / meaning
- [ ] Popularity trend (rising / falling / stable)
- [ ] Famous namesakes
- [ ] Sibling name compatibility indicator

### AI chat feature
- [ ] Natural language name exploration ("find me something like Clementine but shorter")
- [ ] Answer questions about a name (meaning, history, pronunciation)
- [ ] Help resolve disagreements between partners

### AI list generator
- [ ] Generate a starter list from a style description ("Southern, vintage, one syllable")
- [ ] Import from external sources (family names, inspiration lists)
- [ ] Export / share lists

---

## Recommendation Model

### High priority
- [ ] **Collaborative filtering** — co-like signals once real users exist; highest single-improvement lever
- [ ] **Multi-vector taste representation** — cluster liked names into 2–3 style groups instead of single average; handles bimodal preferences (user who likes both biblical and nature names)
- [ ] **Rarity preference detection** — detect from swipe history whether user prefers rare vs. common names; adjust minimum count threshold accordingly
- [ ] **Partner taste blending** — blend both partners' taste vectors (`0.5 * user + 0.5 * partner`) for ANN query instead of just priority-sorting partner-liked names

### Medium priority
- [ ] **Trend velocity feature** — add 3–5 year popularity slope from RDS `name_popularity` data; distinguishes "peaked 2020, now declining" from "peaked 2020, still rising"
- [ ] **Dynamic minimum count floor** — lower 200-birth floor for users who revealed rarity preference (currently filters good names: Melrose, Dawn, Rue, Ellsworth)
- [ ] **Skip signal** — capture quick-swipe-past as implicit dislike; improve taste vector quality

### Lower priority
- [ ] **Sibling name compatibility** — factor in existing children's names for families on their second+ child
- [ ] **Origin language-family grouping** — replace flat one-hot with language family hierarchy (Romance / Germanic / Celtic / Biblical / etc.)
- [ ] **Fine-tuned embedding model** — train on baby name co-like data for better semantic separation than general-purpose text-embedding-3-small

---

## Infrastructure
- [ ] Deploy recommendations and swipe Lambda functions (handlers written, not yet wired to API Gateway)
- [ ] Cognito auth integration (guest browsing works; account required for swipes/lists)
- [ ] App Store submission
