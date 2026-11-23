---
name: database-firebase
description: Database schema design, SQL, Firebase and data migrations
---

Identify the database engine and existing schema before proposing changes.
Prefer additive migrations, explicit constraints, indexes, transactions, and rollback plans.
For Firebase, inspect Auth, Firestore rules, indexes, emulator configuration, and client/server trust.
Never loosen security rules to make a test pass. Never expose service-account credentials.
