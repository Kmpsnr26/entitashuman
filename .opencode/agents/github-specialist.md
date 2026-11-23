---
description: GitHub branches, issues, pull requests and repository management
mode: subagent
model: opencode/nemotron-3.5-lightning-free
permissions:
  - action: shell
    resource: "*"
    effect: ask
  - action: edit
    resource: "*"
    effect: ask
  - action: external_directory
    resource: "*"
    effect: ask
  - action: github_*
    resource: "*"
    effect: ask
---
