# Node-RED Flow Structure Analysis

## Overview
- **Total Nodes**: 516
- **Tabs (Main Flows)**: 11
- **Subflows**: 8
- **Function Nodes**: 30
- **Analysis Date**: 2025-07-25T21:14:49.174Z

## Tabs (Main Flows)
- **Cache Home 🏡** (ID: 4f871e90.29a61)
- **Is Home 🔍** (ID: fbed070118aafd67)
- **Day 🌞/Night 🌚** (ID: a807a4834abd67fa)
- **Thermostat Time of Use** (ID: 88965fe6e95d05d9) [DISABLED]
- **Plants 🌱** (ID: e921812388e8a474)
- **Blinds 🕶️** (ID: 4b8fb0bd081363a3)
- **Bathroom Fans 🚽** (ID: 2c89cfc34655fd37)
- **Presence** (ID: f5468ca00e94e761)
- **Batteries** (ID: e05fae85092ccf96)
- **Piano 🎹** (ID: f8ef387edcc58dc1)
- **Remote Entities** (ID: 6337f535d7b8e1f2)

## Subflows
- **Cache House States Away** (ID: dc6c7d82059d5798) - 1 inputs, 2 outputs
- **Get Domain Entities** (ID: e920ad5e223ac1b7) - 1 inputs, 1 outputs
- **Set Unavailable** (ID: c15b1459ec3be250) - 1 inputs, 1 outputs
- **Presence Subflow** (ID: 173c5faccfb73051) - 1 inputs, 0 outputs
- **Get Area Entities** (ID: b0e3e1c3c40d9540) - 1 inputs, 1 outputs
- **Set Null User** (ID: bfb9a6c8a64bb052) - 1 inputs, 1 outputs
- **Action Node with Check** (ID: 8021f5177f6126d9) - 1 inputs, 1 outputs
- **Force Set State** (ID: 685bfaf1e94471c7) - 1 inputs, 1 outputs

## Function Nodes by Flow
### Cache Home 🏡 (4 functions)
  - push cached states (ID: 3f3963cff3716131)
  - push cached states (ID: 715a229a5e312dca)
  - filter blacklisted entities (ID: 08f84c6d37343c7a)
  - home status (ID: 20d9cf93f238d30f)

### Day 🌞/Night 🌚 (8 functions)
  - create schedule cron (ID: 872a4dcbed026511)
  - merge cached states (ID: fcef4072b3d808c5)
  - merge scene cached states (ID: 57ba98e05115a206)
  - create schedule cron (ID: 76883f7cb338fb52)
  - inside preamble window (ID: 8707143d8533922c)
  - guest daytime (ID: b2b315489cc8d2a7)
  - cache schedule entity (ID: d22ac4c1c222afd5)
  - pop schedule entity cache (ID: 6bc7f26c9c624e6c)

### Thermostat Time of Use (1 functions)
  - function (ID: 8f4c1ad0cad49211)

### Plants 🌱 (4 functions)
  - set static state (ID: 04f8709ebd6588c0)
  - schedule (ID: 8baf517e98f7f1a1)
  - filter blacklisted entities (ID: 3cbb13d1da946813)
  - schedules (ID: 2f73425d194d82fa)

### Presence (1 functions)
  - function 1 (ID: 55653f952629f321)

### Batteries (1 functions)
  - battery (ID: 9b723d99a73d643f)

### Remote Entities (2 functions)
  - get entity attributes id (ID: e2cb1e6a7e2044f7)
  - create service call (ID: ba17a7bee754d74a)

## Function Nodes in Subflows
### Cache House States Away (2 functions)
  - states to actions (ID: 5cd5c7a97cbfb2a5)
  - cache house state (ID: fd875b9553cf1720)

### Get Domain Entities (3 functions)
  - filter hidden entities and domains (ID: 420bdf56a9545130)
  - reconcile entities (ID: f3f79edb0a0bc587)
  - filter entities (ID: fe549fb394a9227a)

### Presence Subflow (2 functions)
  - presence (ID: f633b8e8b3205bc1)
  - get flow info (ID: f59de909516cb178)

### Get Area Entities (1 functions)
  - filter blacklisted entities (ID: 627b25edecfe582e)

### Action Node with Check (1 functions)
  - action node (ID: c04368f701cd604d)

## Key Findings
1. The "z" property indicates which flow (tab or subflow) a node belongs to
2. Function nodes can be updated programmatically by modifying their "func" property
3. Each flow has a unique ID that can be used for targeted updates via the API
4. Subflows are reusable components that can contain their own nodes

## API Deployment Strategy
To update a specific function node via API:
1. GET /flows to retrieve current flows
2. Find the function node by ID
3. Update the "func" property with new code
4. POST /flows with updated flows array
5. POST /flows/reload to apply changes

To update only a specific flow:
1. GET /flow/:id to get specific flow
2. Update nodes in that flow
3. PUT /flow/:id with updated flow
