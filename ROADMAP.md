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
- [ ] P1 Sibling name compatibility indicator
- [X] Name meaning in details card
- [ ] P1 Name prevalence (likely hood of another in the class) 
- [ ] P1 Similar names: 1) vibe 2) sounds like

### Name tags
- [x] User-defined tags on liked names ("Favorite", "Family Name", "Middle Name" + custom)
- [x] Filter My Lists by tag
- [x] Partner can see each other's tags to understand why a name was liked

### AI chat feature & list generator
- [ ] Natural language name exploration for list generation("find me something like Clementine but shorter")
- [ ] Answer questions about a name (meaning, history, pronunciation)
- [ ] Analysis of names the user has liked and suggestions based on patterns

---

## Recommendation Model

### Completed
- [x] **Multi-vector taste representation** — k-means clusters liked names into 2–3 style groups (k=2 at 8+ swipes, k=3 at 20+); round-robin interleaves results to maintain style diversity
- [x] **Partner taste blending** — blend both partners' taste vectors (`0.5 * user + 0.5 * partner`) for ANN query instead of just priority-sorting partner-liked names
- [x] **Long-tail exploration** — diversity component injects long-tail names weighted by origin/style fit
- [x] **Skip signal** — quick-swipe-past captured as implicit dislike to improve taste vector quality
- [x] **Embedding model upgrade** — switched from `text-embedding-3-small` to `text-embedding-3-large` (Matryoshka, `dimensions=512`); oracle recall@100 improved 45% → 56%, Reddit co-occurrence recall +28%
- [x] **Retrieval tuning** — K-sweep confirmed K=100 is optimal production ceiling; hill-climb found `scale=7`, `origin_weight=1.5` as optimal eval-time parameters
- [x] **Two-stage reranker** — GBC reranker trained on 177 LLM-generated anchor/gold/trap sets; blended scoring (`0.2 × cosine + 0.8 × reranker`); oracle recall@20 +2pp, trap rate -2pp

### High priority
- [ ] **Collaborative filtering** — co-like signals once real users exist; highest single-improvement lever
- [ ] **Rarity preference detection** — detect from swipe history whether user prefers rare vs. common names; adjust minimum count threshold accordingly
- [ ] **Bimodal multi-vector improvement** — current k-means correctly separates style clusters but celestial/modern cluster ANN neighbors collapse into generic popular names; needs investigation

### Medium priority
- [ ] **Trend velocity feature** — add 3–5 year popularity slope from RDS `name_popularity` data; distinguishes "peaked 2020, now declining" from "peaked 2020, still rising"

### Lower priority
- [ ] **Sibling name compatibility** — factor in existing children's names for families on their second+ child
- [ ] **Origin language-family grouping** — replace flat one-hot with language family hierarchy (Romance / Germanic / Celtic / Biblical / etc.)
- [ ] **Fine-tuned embedding model** — train on baby name co-like data for better semantic separation; `text-embedding-3-large` is current ceiling without fine-tuning

---

## Infrastructure
- [x] Deploy recommendations and swipe Lambda functions (handlers written, not yet wired to API Gateway)
- [ ] Cognito auth integration (guest browsing works; account required for swipes/lists)
- [ ] App Store submission
