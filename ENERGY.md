# Energy & Lighting Reference

**Location**: 200 Cary Pines Dr, Cary NC 27513
**Utility**: Duke Energy Progress — Residential Service (RES)
**Last Updated**: 2026-02-12

---

## Duke Energy Rate Structure

| Tier | Range | Rate ($/kWh) |
|------|-------|-------------|
| Base Facility Charge | — | $14.00/mo |
| Tier 1 | First 800 kWh | $0.12623 |
| Tier 2 | Above 800 kWh | $0.11623 |
| Riders + Taxes + Fees | — | ~$0.038/kWh |
| **Effective All-In Rate** | — | **$0.1647/kWh** |

Budget billing: $292/month (quarterly adjustment).

## Actual Usage (from Duke Energy Green Button XML export)

| Period | kWh | Notes |
|--------|-----|-------|
| 2025 Total | 19,491 kWh | 12-month rolling |
| 2025 Monthly Avg | 1,596 kWh | |
| Peak Month | July 2024: 2,169 kWh | Summer AC |
| Low Month | March 2024: 1,022 kWh | Shoulder season |
| Jan 2026 Bill | 1,842 kWh (29 days) | $303.42 |

Data source: 2 years of 15-min interval data (73,152 readings, 100% actual).

### Duke Disaggregation Breakdown (annual, base rate $0.1192/kWh)

| Category | Annual Cost | Est. kWh | % of Total |
|----------|------------|----------|------------|
| Other | $780 | 6,544 | 33.6% |
| AC | $588 | 4,933 | 25.3% |
| Always On | $384 | 3,222 | 16.5% |
| Heating | $156 | 1,309 | 6.7% |
| EV | $108 | 906 | 4.6% |
| Lighting | $124 | 1,040 | 5.3% |
| Laundry | $60 | 503 | 2.6% |
| Refrigeration | $48 | 403 | 2.1% |
| Cooking | $18 | 151 | 0.8% |
| **Total** | **$2,266** | **~19,011** | |

> **Note**: Duke's NILM disaggregation miscategorizes grow lights. Smart plug loads lack dimming signatures, so grow lights appear in "Other" and "Always On" rather than "Lighting". The "Lighting" category ($124/yr) only captures hardwired Z-Wave fixtures.

---

## Grow Light Inventory (26 devices, 27 entities, 1,069W)

### Schedule Groups (measured Feb 5-12, 2026)

| Group | Entities | Watts | Schedule | Measured Avg | Monthly |
|-------|----------|-------|----------|-------------|---------|
| Global | 20 | 882W | 09:00–20:21 | 12.9 hrs/day | $57 |
| Bedroom | 5 | 139W | wakeup–sleep (14:42–20:21) | 6.5 hrs/day | $4 |
| Warocqueanum (titanic) | 1 | 48W | Presence-based sub-schedules | 5.6 hrs/day | $1 |
| **Total** | **26** | **1,069W** | — | **11.7 hrs/day weighted** | **$63/mo ($751/yr)** |

### Global Schedule Entities (09:00–20:21, ~12 hrs/day)

| Entity | Physical Device | W | Plug |
|--------|----------------|---|------|
| `switch.grow_light_shelf_1` | 3× Dommia (2-head, 10W ea) + 1× 60W eqv 8W | 38 | SONOFF S31 Lite zb |
| `switch.grow_light_shelf_2` | 3× Dommia (2-head, 10W ea) + 1× 60W eqv 8W | 38 | Third Reality 3RSP019BZ |
| `switch.fireplace_grow_light_switch` | 1× Barrina T8 30W | 30 | SONOFF S40LITE |
| `switch.fireplace_grow_light_1_switch` | 1× 60W eqv 8W + 3× Soltech Highland 30W/head | 98 | SONOFF S40LITE |
| `switch.fireplace_grow_light_2_switch` | 1× Valikiy 40W | 40 | SONOFF S40LITE |
| `switch.desk_grow_light_switch_3` | 1× Barrina T8 30W | 30 | SONOFF S40LITE |
| `switch.office_bookshelf_grow_light` | 1× Valikiy 40W | 40 | Third Reality 3RSP019BZ |
| `switch.kitchen_grow_light_shelf_switch_5` | 2× 60W eqv 8W + 2× Dommia (2-head, 10W ea) | 36 | SONOFF S40LITE |
| `switch.stairwell_pendant_grow_light_1_switch_2` | 1× Soltech Vita 20W | 20 | SONOFF S40LITE |
| `switch.stairwell_pendant_grow_light_2_switch_3` | 1× Soltech Vita 20W | 20 | SONOFF S40LITE |
| `switch.fierce_diety_s_mask_grow_light_switch` | 1× Valikiy 40W | 40 | SONOFF S40LITE |
| `switch.majora_s_mask_grow_light_switch_4` | 1× Bstrip 25W | 25 | SONOFF S40LITE |
| `switch.grow_light_bookshelf_1_switch` | 4× Barrina T8 30W + 1× Barrina T10 4ft 42W | 162 | SONOFF S40LITE |
| `switch.fridge_grow_light_switch` | 1× Bstrip 25W | 25 | Third Reality 3RSP019BZ |
| `switch.piano_grow_light_2_switch_2` | 1× 60W eqv 8W | 8 | SONOFF S40LITE |
| `light.pikachu_grow_light` | 1× 60W eqv 8W + 3× Soltech Highland 30W/head + 4× Cefrank 3W | 110 | SONOFF S40LITE |
| `switch.bonus_room_grow_light_switch_2` | 1× Barrina T10 4ft 42W | 42 | SONOFF S40LITE |
| `switch.bonus_room_grow_light_switch_6` | 1× Soltech Vita 20W | 20 | SONOFF S40LITE |
| `switch.master_bedroom_bird_of_paradise_grow_light_switch` | 1× Soltech Vita 20W | 20 | SONOFF S40LITE |
| `switch.master_bedroom_pineapple_grow_light_switch` | 1× Valikiy 40W | 40 | SONOFF S40LITE |

### Bedroom Schedule Entities (wakeup 14:42 – sleep 20:21, ~6 hrs/day)

| Entity | Physical Device | W | Plug |
|--------|----------------|---|------|
| `switch.master_bedroom_bomb_grow_light` | 1× Bstrip 25W | 25 | SONOFF S31 Lite zb |
| `switch.master_bedroom_kid_s_theme_grow_light_switch` | 1× Edearkar MR16 9W | 9 | SONOFF S40LITE |
| `switch.guest_bedroom_grow_light` | 1× Bstrip 25W | 25 | Third Reality 3RSP019BZ |
| `switch.guest_bedroom_grow_light_2` | 1× Valikiy 40W | 40 | Third Reality 3RSP019BZ |
| `switch.warocqueanum_bedroom_grow_light_switch` | 1× Valikiy 40W (Queen Anthurium) | 40 | Third Reality 3RSP019BZ |

### Warocqueanum / Titanic (~5.6 hrs/day, presence-based)

| Entity | Physical Device | W | Plug |
|--------|----------------|---|------|
| `light.titanic_light` | 1× 60W eqv 8W + 1× Valikiy 40W | 48 | SONOFF S40LITE |

### Grow Light Product Inventory

| Product | Units | W Each | Total W |
|---------|-------|--------|---------|
| Valikiy 40W hanging grow light | 7 | 40 | 280 |
| Soltech Highland 30W/head track light | 6 heads | 30 | 180 |
| Barrina T8 3ft 30W tube | 6 | 30 | 180 |
| Bstrip 25W hanging grow light (Soltech knock-off) | 4 | 25 | 100 |
| Barrina T10 4ft 42W standing | 2 | 42 | 84 |
| Soltech Vita 20W PAR30 bulb | 4 | 20 | 80 |
| Dommia USB 2-head (5W/panel) | 8 | 10 | 80 |
| 60W equivalent LED (8W) in clamp reflectors | 8 | 8 | 64 |
| Cefrank V-Shape 12" LED bar (3W) | 4 | 3 | 12 |
| Edearkar MR16 E26 9W (reptile light) | 1 | 9 | 9 |
| **Total** | **50 components** | — | **1,069** |

### Measured Daily Energy by Entity (7-day sample, Feb 5-12 2026)

| Entity | W | Hrs/Day | Wh/Day | $/Mo |
|--------|---|---------|--------|------|
| `grow_light_bookshelf_1` | 162 | 13.2 | 2,138 | $10.73 |
| `pikachu_grow_light` | 110 | 13.2 | 1,452 | $7.29 |
| `fireplace_grow_light_1` | 98 | 13.2 | 1,294 | $6.49 |
| `bonus_room_grow_light_2` | 42 | 13.5 | 567 | $2.84 |
| `fireplace_grow_light_2` | 40 | 13.2 | 528 | $2.65 |
| `fierce_diety` | 40 | 13.2 | 528 | $2.65 |
| `office_bookshelf` | 40 | 13.2 | 528 | $2.65 |
| `grow_light_shelf_1` | 38 | 13.2 | 502 | $2.52 |
| `grow_light_shelf_2` | 38 | 13.2 | 502 | $2.52 |
| `kitchen_grow_light_shelf` | 36 | 13.2 | 475 | $2.38 |
| `desk_grow_light` | 30 | 13.2 | 396 | $1.99 |
| `pineapple` | 40 | 8.9 | 356 | $1.79 |
| `fireplace_grow_light` | 30 | 11.7 | 351 | $1.76 |
| `majora_s_mask` | 25 | 13.2 | 330 | $1.66 |
| `fridge_grow_light` | 25 | 12.8 | 320 | $1.61 |
| `titanic_light` | 48 | 5.6 | 269 | $1.35 |
| `stairwell_pendant_1` | 20 | 13.2 | 264 | $1.32 |
| `stairwell_pendant_2` | 20 | 13.2 | 264 | $1.32 |
| `bonus_room_grow_light_6` | 20 | 13.2 | 264 | $1.32 |
| `guest_bedroom_2` | 40 | 6.6 | 264 | $1.32 |
| `warocqueanum_bedroom` | 40 | 6.4 | 256 | $1.28 |
| `bomb` | 25 | 6.5 | 163 | $0.82 |
| `bird_of_paradise` | 20 | 8.0 | 160 | $0.80 |
| `guest_bedroom` | 25 | 6.3 | 158 | $0.79 |
| `piano_grow_light_2` | 8 | 13.2 | 106 | $0.53 |
| `kid_s_theme` | 9 | 6.3 | 57 | $0.29 |
| **Total** | **1,069** | **11.7 avg** | **12,490** | **$62.66** |

Top 3 entities (bookshelf + pikachu + fireplace 1) account for **39%** of all grow light cost.

### Grow Light Cost Projections (all 1,069W at $0.1647/kWh)

| Daily Hours | kWh/Day | $/Month | $/Year |
|------------|---------|---------|--------|
| 6 | 6.41 | $32 | $386 |
| 8 | 8.55 | $43 | $515 |
| 10 | 10.69 | $54 | $643 |
| **11.7 (measured)** | **12.49** | **$63** | **$751** |
| 12 | 12.83 | $64 | $771 |
| 14 | 14.97 | $75 | $900 |
| 16 | 17.10 | $86 | $1,028 |
| 24 | 25.66 | $129 | $1,543 |

---

## All Lights Catalog

### LIFX Smart Bulbs (16 bulbs, ~155W)

| Entity | Model | W |
|--------|-------|---|
| `light.kitchen_pendant_1` | LIFX A19 US | 11 |
| `light.kitchen_pendant_2` | LIFX A19 | 11 |
| `light.kitchen_pendant_3` | LIFX A19 US | 11 |
| `light.fishing_lamp` | LIFX Color | 11 |
| `light.rose_light_1` | LIFX Color | 11 |
| `light.rose_light_2` | LIFX Color US | 11 |
| `light.squiggle_lamp` | LIFX Color US | 11 |
| `light.goblet_light` | LIFX Color US | 11 |
| `light.master_bedroom_tiffany_light_2` | LIFX Color US | 11 |
| `light.hanging_light_1` | LIFX Mini Color | 9 |
| `light.hanging_light_3` | LIFX Mini Color | 9 |
| `light.pineapple_light` | LIFX Mini Color | 9 |
| `light.kid_s_theme_desk_light` | LIFX Mini Color | 9 |
| `light.hanging_light_2` | LIFX Clean | 11.5 |
| `light.butterfly_light_1` | LIFX Candle Color US | 4.2 |
| `light.butterfly_light_2` | LIFX Candle Color US | 4.2 |

Groups: `light.hanging_light` (1+2+3), `light.kitchen_pendants` (1+2+3), `light.rose_light` (1+2)

### Philips Hue (2 devices, ~13W)

| Entity | Model | W |
|--------|-------|---|
| `light.playbar_1_huelight` | Hue Play Bar | 6.6 |
| `light.playbar_2_huelight` | Hue Play Bar | 6.6 |

Group: `light.tv_lights` (1+2)

### Z-Wave / Hardwired Fixtures (~611W)

| Entity | Switch | Bulb(s) | W |
|--------|--------|---------|---|
| `light.kitchen_can_lights` | ZW3011 dimmer | 5× BR30 9W | 45 |
| `light.office_ceiling_light` | ZW3011 dimmer | 20W 15" flush mount | 20 |
| `light.dining_room_ceiling_light` | ZW3011 dimmer | 5× candelabra 6W | 30 |
| `light.bonus_room_ceiling_light` | ZW4009 on/off | 3× 60W eqv 8W | 24 |
| `light.guest_bedroom_ceiling_light` | ZW3010 dimmer | ~15W flush mount | 15 |
| `light.plant_ceiling_light` | ZWA4012 | ~15W flush mount | 15 |
| `light.master_bedroom_ceiling_fan_light` | ZW4008DV | 1× 60W eqv 8W | 8 |
| `light.upstairs_hallway_lights` | ZW4008DV | 2× ceiling ~15W | 30 |
| `light.master_bedroom_closet_light` | ZW4009 on/off | 1× 60W eqv 8W | 8 |
| `light.entryway_light` | ZW4009 on/off | ~15W flush mount | 15 |
| `light.front_porch_lights` | ZW4009 on/off | outdoor fixture | 15 |
| `light.back_deck_lights` | ZW4009 on/off | outdoor fixture | 15 |
| `light.laundry_room_light` | ZW4009 on/off | ~15W flush mount | 15 |
| `light.downstairs_bathroom_light` | ZW4009 on/off | 3× 60W eqv 8W | 24 |
| `light.master_bathroom_light_1` | ZW4009 on/off | 3× 60W eqv 8W | 24 |
| `light.master_bathroom_light_2` | ZW4009 on/off | 3× 60W eqv 8W | 24 |
| `light.guest_bathroom_light` | ZW4009 on/off | 3× 60W eqv 8W | 24 |
| `light.garage_light_1` | Third Reality plug | 5× 60W eqv 8W | 40 |
| `light.garage_light_2` | Third Reality plug | 1× Barrina T10 4ft 42W | 42 |
| `light.garage_light_3` | Third Reality plug | 1× 60W eqv 8W | 8 |
| `light.garage_shelf_light_1` | Third Reality plug | 5× Barrina T8 30W | 150 |

### Smart-Plug Decorative / Accent Lights (~299W)

| Entity | Physical Device | W | Plug |
|--------|----------------|---|------|
| `light.hey_lamp` | Integrated lamp | 8 | SONOFF S40LITE |
| `light.hey_lamp_3` | 2× Leools G25 6W | 12 | Third Reality |
| `light.palette_light` | 5× Leools G25 6W | 30 | SONOFF S40LITE |
| `light.paintbucket_light` | Comzler A15/G45 6W | 6 | Third Reality |
| `light.paintbucket_light_2` | Comzler A15/G45 6W | 6 | Third Reality |
| `light.kaiser_light` | Comzler A15/G45 6W | 6 | SONOFF S40LITE |
| `light.pencil_light` | Comzler A15/G45 6W | 6 | Tuya |
| `light.sunflower_light` | Joossnwell 15.5" 7W picture light | 7 | SONOFF S31 Lite zb |
| `light.goldfish_light` | Joossnwell 15.5" 7W picture light | 7 | Third Reality |
| `light.ophelia_light` | Joossnwell 15.5" 7W picture light | 7 | SONOFF S40LITE |
| `light.jenny_light` | Joossnwell 23.62" 14W picture light | 14 | Third Reality |
| `light.office_monitor_light` | APMIEK 24W desk lamp (dual-head) | 24 | template entity |
| `light.piano_salt_lamp` | Salt lamp (15W incandescent) | 15 | Third Reality |
| `light.xbox_light` | LED neon sign 14×8" | 20 | Third Reality |
| `light.penguin_light` | Small integrated lamp | 6 | SONOFF S40LITE |
| `light.pixar_lamp` | Desk lamp w/ 60W eqv 8W | 8 | SONOFF S31 Lite zb |
| `light.flower_lamp` | 3× 60W eqv 8W | 24 | Third Reality |
| `light.seashell_nightlight` | Nightlight | 5 | Third Reality |
| `light.bonus_room_light` | 3× 60W eqv 8W | 24 | SONOFF S31 Lite zb |
| `light.dining_room_christmas_lights` | Christmas string lights + G25 | 12 | SONOFF S31 Lite zb |
| `light.downstairs_bathroom_chili_pepper_lights` | Chili pepper string lights | 5 | SONOFF S31 Lite zb |
| `light.master_bathroom_chili_pepper_lights` | Chili pepper string lights | 5 | SONOFF S40LITE |
| `light.guest_bathroom_peppa_pig_lights` | Novelty string lights | 5 | SONOFF S40LITE |
| `light.under_cabinet_lights_1` | 4× B&D 9" bar (5W ea) + 4× Cefrank 12" (3W ea) | 32 | SONOFF S40LITE |
| `light.under_cabinet_lights_2` | 1× B&D 9" bar 5W | 5 | SONOFF S40LITE |

Note: `light.kitchen_cabinet_lights` is a group of `under_cabinet_lights_1` + `under_cabinet_lights_2` (37W combined).

### Seasonal / Unavailable

| Entity | Physical Device | W |
|--------|----------------|---|
| `light.christmas_tree_light` | Christmas tree | ~50 |
| `light.desk_christmas_lights` | Desk string lights | ~6 |
| `light.stairwell_christmas_lights` | Stairwell string lights | ~6 |
| `light.hey_lamp_2` | Master bedroom Christmas tree | ~50 |
| `light.hey_lamp_2_2` | Hey Lamp 2 | ~6 |

### Miscellaneous

| Entity | Notes | W |
|--------|-------|---|
| `light.ratgdov25i_4b1c3b_light` | Garage door opener light | ~10 |

---

## Hardware Product Reference

| Product | Wattage | Type | Amazon |
|---------|---------|------|--------|
| LIFX Color A19 | 11W | Smart bulb (E26, 1100lm, color) | — |
| LIFX Mini Color | 9W | Smart bulb (E26, 800lm, color) | — |
| LIFX Clean A19 | 11.5W | Smart bulb (E26, 1100lm, HEV) | — |
| LIFX Candle Color | 4.2W | Smart bulb (E12, 480lm, color) | — |
| Philips Hue Play Bar | 6.6W | Smart light bar (500lm, color) | — |
| Valikiy 40W | 40W | Hanging grow light (full spectrum) | B0C9WHQH3X |
| Soltech Vita | 20W | PAR30 grow bulb (E26, 3000K) | B091V5ZWPM |
| Soltech Highland | 30W/head | Track grow light (3000K) | — |
| Bstrip 25W (Soltech knock-off) | 25W | Hanging grow light (3000K) | B0D31LKBC3 |
| Barrina T8 3ft | 30W | Tube grow light (linkable) | B0B76YGD7F |
| Barrina T10 4ft standing | 42W | Standing grow light (w/ tripod) | B0CKXMCB6J |
| Dommia USB (2-head) | 10W (5W/panel) | Shelf grow light (USB, dimmable) | B0DQ1KX5XP |
| Edearkar MR16 E26 | 9W | Spotlight (4000K, 24° beam) | — |
| Cefrank V-Shape 12" | 3W/bar | Under-shelf display light (3000K) | B0BDDGTQXS |
| B&D Smart Under Cabinet 9" | 5W | Under-cabinet bar (smart, adjustable) | B08SHNS3Y4 |
| Joossnwell 15.5" | 7W | Picture frame light (3000K) | B0BPGJD94M |
| Joossnwell 23.62" | 14W | Picture frame light (3000K) | B0D53Y86JP |
| APMIEK Desk Lamp | 24W | Dual-head clamp desk lamp (dimmable) | — |
| Leools G25/G80 | 6W | Globe LED (E26, dim-to-warm) | — |
| Comzler A15/G45 | 6W | Appliance LED (E26, 2700K) | — |
| 60W equivalent LED | 8W | Standard A19 LED (various) | — |
| Salt lamp bulb | 15W | Incandescent (E12, heat required) | — |

---

## Smart Plug Census (Zigbee)

| Model | Units |
|-------|-------|
| SONOFF S40LITE | 19 |
| SONOFF S31 Lite zb | 7 |
| Third Reality 3RSP019BZ | 12 |
| eWeLink ZR03-1 | 1 (deprecated) |
| Tuya Smart Plug | 1 |

---

## Summary Totals (measured Feb 5-12, 2026)

| Category | Devices | Installed W | kWh/Day | kWh/Mo | $/Month |
|----------|---------|-------------|---------|--------|---------|
| Grow Lights | 26 | 1,069 | 12.49 | 380 | $63 |
| LIFX Bulbs | 16 | 155 | 0.51 | 15 | $3 |
| Philips Hue | 2 | 13 | 0.14 | 4 | $1 |
| Z-Wave / Hardwired | 21 | 611 | 2.08 | 63 | $10 |
| Decorative / Accent | 25 | 299 | 1.97 | 60 | $10 |
| **Total** | **90** | **~2,147** | **17.19** | **522** | **$86** |

### Key Observations

- Grow lights represent **~50% of installed wattage** but **~73% of lighting electricity cost** ($63/$86) due to 11.7 hrs/day average run-time
- **Top 3 grow lights** (bookshelf 162W, pikachu 110W, fireplace 1 98W) alone cost **$24.51/mo** — 28% of all lighting
- LIFX brightness dimming reduces their draw to **~1/3 of rated wattage** (most run at 14-43% brightness)
- Total lighting: **522 kWh/month** = **~27% of total home usage** (1,596 kWh/mo avg)
- Duke's NILM "Lighting" category captures only $10/mo of hardwired fixtures; the remaining $76/mo is miscategorized as "Other" and "Always On"
