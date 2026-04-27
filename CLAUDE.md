# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Before Writing Any Code

**Always check with the user before writing any code.** Describe what you plan to build — the approach, files affected, and any architectural decisions — and wait for approval before proceeding.

## Project Overview

BabyNames is a React Native iOS app that helps couples find the right baby name. Core features:
- Browse and swipe on names (Tinder-style)
- Upload lists of names from external sources
- Suggest similar names based on selections
- View popularity trends over time
- Filter and explore names by origin

## Architecture

### Monorepo Structure

```
/
├── app/          # React Native (iOS) app
├── backend/      # Lambda functions and infrastructure
│   ├── functions/    # Individual Lambda handlers
│   └── infra/        # IaC (CDK or SAM)
└── data/         # Dataset processing scripts and raw data
```

### AWS Backend Services

| Service | Role |
|---|---|
| **API Gateway** | REST API — single entry point for the app |
| **Lambda** | API logic, similarity scoring, trend calculation |
| **DynamoDB** | Name records — origin, spellings, metadata, gender |
| **RDS (PostgreSQL)** | Yearly popularity data — time-series range queries |
| **S3** | Raw name datasets, user-uploaded name lists |
| **Cognito** | Auth — guest browsing allowed, account required to save swipes/lists |

### Data Flow

```
React Native app
  → API Gateway
  → Lambda (business logic)
  → DynamoDB (name metadata) or RDS (popularity queries)
  → S3 (for list uploads / raw data)
```

## Core Data Model

A name record contains:
- Name string + alternate spellings
- Origin(s)
- Gender
- Yearly popularity data (sourced from SSA or equivalent dataset)
- Similar names references

## Key Design Decisions

- **No Amplify** — using raw AWS services for full control over complex queries (similarity, trends)
- **DynamoDB for metadata, RDS for trends** — time-series popularity queries need relational range scans; name metadata fits document storage
- **Guest mode** — users can browse without signing in; Cognito auth gates saving and list features
