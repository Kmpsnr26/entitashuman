---
description: Image and document understanding using NVIDIA Nemotron 3.5 Super VL
mode: subagent
model: opencode/nemotron-3.5-lightning-free
permissions:
  - action: shell
    resource: "*"
    effect: deny
  - action: edit
    resource: "*"
    effect: deny
  - action: external_directory
    resource: "*"
    effect: deny
---
