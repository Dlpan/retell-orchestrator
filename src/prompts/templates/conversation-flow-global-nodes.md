# Conversation Flow — Global Node Design
# Business Type: [Mobile Grooming | Salon Grooming]
# Version: 1.1

---

## Overview

The conversation flow is split into:

| Type | Nodes | Description |
|---|---|---|
| Main flow (linear) | MF-01 `GREETING` · MF-02 `BOOKING` · MF-03 `INQUIRY` | Sequential paths the AI walks through step by step |
| Global Nodes | GN-01 through GN-08 | Self-contained handlers that can activate from any point in the conversation |

**Why Global Nodes?**
Rather than drawing lines from every node to every possible interruption, Global Nodes are activated by trigger conditions. The main flow stays clean; the AI auto-routes to the right Global Node the moment a condition is met.

---

## Global Node Spec Format

Each node defines:
- **Purpose** — what this node is responsible for
- **Trigger Condition** — the condition that causes any node to hand off here
- **Entry** — what the AI says or does upon entering
- **Logic** — the step-by-step behavior inside this node
- **Tools** — tool calls made in this node
- **Exits** — where the conversation goes next, and under what condition

---

## Main Flow Nodes

---

## MF-01 · GREETING

**Purpose**
Establish caller identity, run the silent profile lookup, and route to the correct module based on detected intent. This is the entry point for every call.

**Trigger Condition**
Call begins. A static pre-recorded greeting plays automatically. This node activates the moment the caller responds.

**Entry**
Speak immediately — do not wait for any tool result:
- Default (no profile loaded yet): "Thank you for calling {{ business_name }}. How can I help you today?"

**Logic**

*Step 1 — Silent lookup (fires in parallel with entry speech):*
Call `lookup_customer` using `{{ user_number }}` (caller's ANI). Never use the business phone number. Do not announce the lookup.

*Step 2 — When lookup returns:*
- **MATCH (returning lead or customer):**
  Greet by name directly — "Hi [first name from profile]! Great to hear from you." → Proceed to INTENT DETECTION (Step 3).
  - If the caller indicates they are not that person: treat as new lead, proceed naturally to intake.
- **NO MATCH (new lead):**
  Continue naturally. Do not mention that no profile was found.
  → Proceed to INTENT DETECTION (Step 3).

*Step 3 — Intent Detection:*
Listen for the caller's purpose and route accordingly:

| Intent | Caller type | Route to |
|---|---|---|
| Book new appointment | New | `BOOKING` — full intake (Steps 1–7) |
| Book new appointment | Returning (confirmed) | `BOOKING` — skip Steps 1–2 |
| Pricing / service question | Any | `PRICING` (Global Node GN-05) |
| General question | Any | `INQUIRY` |
| Reschedule existing booking | Any | `RESCHEDULE` (Global Node GN-03) |
| Cancel existing booking | Any | `CANCEL` (Global Node GN-04) |
| Complaint / feedback | Any | `ESCALATION` (Global Node GN-01) |
| Same-day late arrival / modification AI can't handle | Any | `ESCALATION` |
| Wants to speak with a person | Any | `ESCALATION` |
| Unclear intent (3 consecutive unresolvable) | Any | `ESCALATION` |

**Tools**
- `lookup_customer`
- `extract_unique_caller_id`
- `get_customer_settings`

**Exits**
| Condition | Next Node |
|---|---|
| Booking intent — new caller | `BOOKING` |
| Booking intent — returning caller | `BOOKING` (shortened path) |
| Pricing question | `PRICING` |
| General question | `INQUIRY` |
| Reschedule / cancel | `RESCHEDULE` / `CANCEL` |
| Complaint / human request / unclear intent | `ESCALATION` |

---

## MF-02 · BOOKING

**Purpose**
Walk the caller through a complete new-appointment booking — from lead creation and pet intake through availability check and appointment confirmation. Handles both new and returning callers. Handles single-pet and multi-pet in one call.

**Trigger Condition**
Caller expresses intent to schedule a new appointment (detected in `GREETING` intent routing or redirected from `INQUIRY`).

**Entry**
- New caller: proceed directly — the greeting already opened the conversation.
- Returning caller (identity confirmed): "Are you looking to get [pet name] scheduled?"

**Logic**

**Step 1 — Lead Info** *(new callers only; skip if returning)*
Collect first name, last name. Phone already known from ANI — confirm only if needed.
Fire `update_lead` (if lead found) or `create_lead` (if no match) as soon as both names are in hand — **non-blocking**, fire in the same turn as the next question.

**Step 2 — Pet Info** *(new callers only; skip if returning)*
Collect one at a time: pet type → pet name → breed → gender → age → weight → coat type → health concerns (optional).
Call `create_pet_for_lead` (vaccineList: `[]`).
Based on breed, weight, and coat, note the right service tier internally — this prepares a natural recommendation in Step 4.

**Step 3 — Address** *(Mobile Grooming only)*
For returning callers: call `get_customer_addresses`.
- Address on file: "We'd be coming to [address] — is that right?" → confirm → proceed.
- No address / new caller: ask for address → call `search_address` (resolve canonical) → confirm back → `get_address` (get lat/lng) → `save_customer_address`.
Salon: skip this step entirely.

**Step 4 — Service Selection**
- Returning caller with known last service: "Would you like the same [service] as last time, or something different?"
- New caller or unknown last service: recommend based on breed + weight + coat type.
Call `get_applicable_services` (serviceType=SERVICE) to confirm service ID + duration.
Immediately fire `get_applicable_services` (serviceType=ADDON) **in parallel** — pre-fetch add-ons while presenting the service recommendation.
If `get_applicable_services` fails or returns no results → go immediately to `BOOKING FALLBACK`.

**Step 5 — Add-ons**
Use the add-on list pre-fetched in Step 4 — no new tool call.
- Add-ons available: offer exactly 2 based on pet history / condition. Accept any answer.
- No add-ons / cat booking: skip to Step 6 without mentioning add-ons.

**Step 6 — Availability Check**
Call `get_all_staff_list` + `get_van_list`, then `smart_schedule`.
Offer a specific slot — never ask "when are you free?"
- Returning caller: slot for preferred groomer first.
- New caller: any available groomer.
If no slots fit after a second `smart_schedule`: → `WAITLIST OFFER` (GN-06).

**Multi-Pet handling:**
After first pet's Steps 4–5, ask: "Do you have any other pets you'd like to include?"
Collect full info per additional pet. Run Step 6 once for all pets combined. Single `create_appointment` call for the whole visit.

**Step 7 — Confirm Booking**
Call `create_appointment`.
Spoken confirmation with groomer name, date, time, pet name, service.
If appointment is > 7 days away: call `create_specialist_task` (note for team to offer earlier opening) + tell caller you'll call if something opens sooner.
If `create_appointment` fails → `BOOKING FALLBACK` (GN-07).

**Tools**
- `update_lead` / `create_lead`
- `create_pet_for_lead` / `create_pet`
- `get_customer_addresses` · `search_address` · `get_address` · `save_customer_address` *(Mobile)*
- `get_applicable_services` (service + add-on, parallel)
- `get_all_staff_list` · `get_van_list` · `smart_schedule`
- `create_appointment`
- `create_specialist_task` *(if booking > 7 days out)*

**Exits**
| Condition | Next Node |
|---|---|
| Booking confirmed | `CLOSE` |
| No availability / slot too far | `WAITLIST OFFER` |
| `get_applicable_services` fails | `BOOKING FALLBACK` |
| `create_appointment` fails | `BOOKING FALLBACK` |
| Caller hesitates / drops off | `DROP-OFF CAPTURE` → `CLOSE` |
| Pricing question mid-flow | `PRICING` → return to `BOOKING` |
| Complaint or human request mid-flow | `ESCALATION` |

---

## MF-03 · INQUIRY

**Purpose**
Answer questions that do not immediately lead to a booking — pricing, services, availability, general FAQ, and business info. Always steer toward booking at the end.

**Trigger Condition**
Caller's intent is informational: asking about pricing, services, service area, business hours, estimated duration, groomer availability, or any general pet grooming question.

**Entry**
Answer the question directly. Do not ask the caller to hold; do not transfer unless the inquiry requires a Tier 2 escalation (see Exits).

**Logic**

*Tier 1 — AI handles end-to-end:*

| Topic | Handling |
|---|---|
| Pricing / service menu | Quote from Business Facts; if breed/weight known, use exact price via `get_applicable_services`; otherwise size-based fallback with "starts at" |
| Service duration | Quote by breed/size from Business Facts |
| Availability check (no booking intent) | Run `smart_schedule` and share earliest slots without committing |
| Mobile: service area | Confirm by zip or address |
| Salon: location, parking, arrival | Answer from Business Facts |
| Salon: whether owner needs to stay / wait time | Answer from Business Facts |
| General grooming FAQ | Answer from `{{ faq }}` |

After every answer, steer toward booking:
"Want me to check availability for [pet] this week?"
If the caller says yes → `BOOKING`.

*Tier 2 — Route to human:*
- Pricing dispute or special pricing request → `ESCALATION`.
- Questions about a past service or incident → `ESCALATION`.

**Tools**
- `get_applicable_services` *(for exact breed-based quote)*
- `create_lead` + `create_pet_for_lead` *(only if creating a by_call lead for exact pricing — see PRICING node)*
- `create_chat` + `send_confirmation_sms` *(if caller requests info via SMS)*

**Exits**
| Condition | Next Node |
|---|---|
| Caller wants to book after inquiry | `BOOKING` |
| Caller satisfied — no booking intent | `CLOSE` |
| Pricing dispute / special request | `ESCALATION` |
| Caller asks about pricing specifically | `PRICING` (GN-05) |

---

## Global Nodes

---

## GN-01 · ESCALATION

**Purpose**
Handle all Tier 2 scenarios that require human involvement: complaints, feedback, requests to speak to a person, and modifications the AI cannot handle autonomously.

**Trigger Condition**
Any of the following at any point in the conversation:
- Caller says "speak to someone", "talk to a person", "manager", "supervisor"
- Caller expresses a complaint or feedback
- Caller requests same-day late arrival handling or a modification the AI cannot complete
- Unclear intent after 3 consecutive unresolvable exchanges

**Entry**
Match tone to context before any action:
- Complaint / frustration: "I'm so sorry to hear that — let me get someone from the team for you."
- Request for human: "Of course, let me connect you now."
- Unclear intent (3 strikes): "Let me get one of our team members to help you out."

**Logic**

*During working hours ({{ working_hours }}):*
1. Speak entry phrase.
2. Call `transfer_call`.
3. If transfer goes unanswered: "Our team is with other customers right now — I'll make sure they reach out to you shortly." → `create_specialist_task` + `create_chat` (include scenario, caller name, reason) → go to `CLOSE`.

*Outside working hours:*
1. Speak entry phrase adapted for off-hours: "Our team isn't available right now, but I'll make sure they get back to you."
2. Collect callback number and any message to pass along.
3. `create_specialist_task` (scenario, caller name, callback number, message).
4. "I'll pass that along — they'll reach out to you soon." → go to `CLOSE`.

**Tools**
- `transfer_call`
- `create_specialist_task`
- `create_chat`

**Exits**
| Condition | Next Node |
|---|---|
| Transfer completed or message taken | `CLOSE` |

---

## GN-02 · URGENT

**Purpose**
Detect emergency or injury situations and flag them immediately without attempting to book or transfer.

**Trigger Condition**
Any of the following keywords appear at any point in the conversation:
"injured", "bleeding", "emergency", "hurt", "sick", "accident" — or strong audible distress from the caller.

**Entry**
Immediately and warmly: "I'm so sorry to hear that."
Do NOT attempt to book, ask follow-up questions, or transfer.

**Logic**
1. Speak entry phrase.
2. Silently call `create_specialist_task` with "URGENT" flag, including caller name, ANI, and verbatim context.
3. Spoken: "I'm flagging this for our team right now — they'll get back to you as soon as possible."
4. Go to `CLOSE`.

**Tools**
- `create_specialist_task`

**Exits**
| Condition | Next Node |
|---|---|
| Always | `CLOSE` |

---

## GN-03 · RESCHEDULE

**Purpose**
Handle reschedule requests end-to-end (Tier 1). AI completes free changes autonomously; routes late changes to the team.

**Trigger Condition**
Caller uses any of: "reschedule", "change my appointment", "move my appointment", "different day", "different time" — at any point in the conversation.

**Entry**
"Of course — let me pull up your upcoming appointments."

**Logic**

**Step 1 — Identify the appointment:**
Call `get_upcoming_appointments`.
- 0 results → speak "I'm not seeing an upcoming appointment on your account" → go to `ESCALATION`.
- 1 result → confirm it back: "Is it the [date/time] appointment for [pet]?"
- Multiple → list briefly, ask which one.
Wait for caller's spoken confirmation before proceeding.

**Step 2 — Check eligibility:**
Call `check_change_eligibility` for the confirmed appointmentId.
Read `byId[appointmentId].isFreeChange`:
- `true` → **FREE RESCHEDULE**
- Anything else (false / missing / tool error) → **LATE RESCHEDULE**

**FREE RESCHEDULE:**
1. Speak a short bridge.
2. Run availability check: `get_all_staff_list` + `get_van_list` → `smart_schedule` (reuse existing petId / serviceIds / serviceDuration; use stored address coordinates or 0,0 for salon).
3. Offer a specific slot: "We have [groomer] available on [day] at [time] — does that work?"
4. On confirmation: call `reschedule_appointment`.
5. Close the loop: spoken confirmation → `create_chat` (caller, pet, old appt, new appt) → `create_specialist_task`.
6. Spoken: "Done! [Groomer] is now scheduled for [pet] on [new day] at [new time]." → go to `CLOSE`.

**LATE RESCHEDULE:**
1. Spoken: "Since this one's coming up soon, our team will take care of getting it moved for you."
2. Collect preferred new timing + contact preference.
3. Close the loop: `create_chat` (caller, pet, current appt, new timing, contact, reason if given) → `create_specialist_task`.
4. Spoken: "Our team will reach out shortly to get that rescheduled for you." → go to `CLOSE`.

**Tools**
- `get_upcoming_appointments`
- `check_change_eligibility`
- `get_all_staff_list` · `get_van_list` · `smart_schedule` (free path only)
- `reschedule_appointment` (free path only)
- `create_chat`
- `create_specialist_task`

**Exits**
| Condition | Next Node |
|---|---|
| 0 upcoming appointments | `ESCALATION` |
| Reschedule completed (free or late) | `CLOSE` |
| `reschedule_appointment` fails after retry | treat as LATE RESCHEDULE → `CLOSE` |
| `check_change_eligibility` fails / invalid | treat as LATE RESCHEDULE → `CLOSE` |

---

## GN-04 · CANCEL

**Purpose**
Handle cancellation requests end-to-end (Tier 1). AI completes free cancellations autonomously; routes late cancellations to the team.

**Trigger Condition**
Caller uses any of: "cancel", "cancel my appointment", "don't need it anymore" — at any point in the conversation.

**Entry**
"Of course — let me pull up your upcoming appointments."

**Logic**

**Step 1 — Identify the appointment:**
Same as GN-03 Step 1. Call `get_upcoming_appointments`.
- 0 results → "I'm not seeing an upcoming appointment on your account" → go to `ESCALATION`.
- 1 or multiple → confirm which appointment with caller.

**Step 2 — Check eligibility:**
Call `check_change_eligibility`. Read `byId[appointmentId].isFreeChange`.
- `true` → **FREE CANCEL**
- Anything else → **LATE CANCEL**

**FREE CANCEL:**
1. Confirm exact appointment back to caller.
2. Ask reason warmly: "Do you mind sharing why — totally fine if not!" Accept any answer.
3. Call `cancel_appointment` (normalized reason string).
4. Close the loop: spoken confirmation → `create_chat` → `create_specialist_task`.
5. Spoken: "Done! And whenever you're ready to rebook, we'd love to get [pet] back on the schedule." → go to `CLOSE`.

**LATE CANCEL:**
1. Spoken: "Since this one's coming up soon, our team will handle the cancellation directly."
2. Collect cancellation reason.
3. Close the loop: `create_chat` (caller, pet, appt, reason) → `create_specialist_task` (flag as time-sensitive).
4. Spoken: "Our team will confirm and follow up with you shortly." → go to `CLOSE`.

**Tools**
- `get_upcoming_appointments`
- `check_change_eligibility`
- `cancel_appointment` (free path only)
- `create_chat`
- `create_specialist_task`

**Exits**
| Condition | Next Node |
|---|---|
| 0 upcoming appointments | `ESCALATION` |
| Cancellation completed (free or late) | `CLOSE` |
| `cancel_appointment` fails after retry | treat as LATE CANCEL → `CLOSE` |
| `check_change_eligibility` fails / invalid | treat as LATE CANCEL → `CLOSE` |

---

## GN-05 · PRICING

**Purpose**
Answer pricing questions with the most accurate quote available — exact when a breed match exists, generic fallback only when necessary. Always steer toward booking after quoting.

**Trigger Condition**
Caller asks about price, cost, or "how much" at any point in the conversation.

**Entry**
Do not ask for the caller's name before quoting. Use existing profile data if available.

**Logic**

Priority order for quoting:
1. **Matched pet profile from `lookup_customer`**: call `get_applicable_services` (serviceType=SERVICE, petId from profile). Quote exact result — do NOT say "starting at".
2. **Caller provided breed + weight in the question, no saved profile**: collect pet name only → `create_lead` (firstName={{ user_number }}, lastName=by_call) → `create_pet_for_lead` → `get_applicable_services`. Quote exact result.
3. **Insufficient pet info**: use size-based fallback from Business Facts. Say "starts at [price]".

After quoting: "Want me to check availability for [pet] this week?"

If caller wants pricing via SMS:
- Exact price: "Hi [name]! For [pet], [service] is [price]. {{#if MOBILE_GROOMING}}We come right to your door!{{/if}}{{#if SALON_GROOMING}}We'd love to see [pet] at the salon!{{/if}} Call {{ business_phone }} whenever you're ready."
- Generic fallback: "Hi [name]! [Service] starts at [price], with final pricing based on breed and weight. Call {{ business_phone }} whenever you're ready."
→ `create_chat` → `send_confirmation_sms`

**Tools**
- `get_applicable_services`
- `create_lead` (by_call, if no existing profile)
- `create_pet_for_lead` (if no existing profile)
- `create_chat`
- `send_confirmation_sms`

**Exits**
| Condition | Next Node |
|---|---|
| Caller wants to book after pricing | `BOOKING` |
| Caller satisfied, no booking intent | `CLOSE` |

---

## GN-06 · WAITLIST OFFER

**Purpose**
Offer and confirm waitlist signup when no suitable availability exists (Tier 1 — AI closes end-to-end).

**Trigger Condition**
Any of the following:
- `smart_schedule` returns empty / no available slots
- Soonest available slot is more than `{{FAR_OUT_THRESHOLD}}` days away
- Caller explicitly says the available slot is too far out for them

**Entry**
"We do have a waitlist — cancellations come up often and you'd be first to know. Want me to add you?"

**Logic**
1. If caller agrees:
2. Collect (one at a time):
   - Preferred timing or timeframe: "Is there a day or time of week that works best?"
   - Service (if not already confirmed)
   - Best contact method: "Is a call or text better for follow-up?"
3. Fire `create_grooming_waitlist` + `create_specialist_task` in parallel (do not wait for results before speaking).
4. Spoken: "You're on the waitlist for [timing] — we'll reach out as soon as something opens up." → go to `CLOSE`.

If caller declines waitlist:
- Go to `BOOKING FALLBACK` to capture basic info for team follow-up.

**Tools**
- `create_grooming_waitlist`
- `create_specialist_task`

**Exits**
| Condition | Next Node |
|---|---|
| Waitlist confirmed | `CLOSE` |
| Caller declines waitlist | `BOOKING FALLBACK` |

---

## GN-07 · BOOKING FALLBACK

**Purpose**
Graceful recovery when booking cannot be completed for any technical or availability reason. Captures enough context for the team to close the sale.

**Trigger Condition**
Any of the following:
- `create_appointment` fails after retry
- `get_applicable_services` returns no results or fails
- Address cannot be resolved (Mobile)
- Caller declines waitlist offer

**Entry**
Stay warm — do NOT reveal the system issue:
"I want to make sure we get [pet] on the calendar — let me grab a couple more details."

**Logic**
Collect the following (one at a time), skipping anything already known:
1. Preferred date or timeframe
2. Preferred groomer — ask only for returning customers; new customers = any
3. Best contact method (call or text)

Once all collected:
- `create_chat` with full detail note: caller name, pet name, service, address (Mobile), preferred timing, groomer preference, contact method
- `create_specialist_task`
- Spoken: "Our team will be reaching out shortly to get [pet] on the schedule — we're really looking forward to taking care of them!" → go to `CLOSE`.

**Tools**
- `create_chat`
- `create_specialist_task`

**Exits**
| Condition | Next Node |
|---|---|
| Always | `CLOSE` |

---

## GN-08 · CLOSE

**Purpose**
Universal call-ending routine. Ensures every interaction ends with a check for additional needs, a warm farewell, and a proper `end_call`.

**Trigger Condition**
Any of the following:
- Booking confirmed (Step 7 complete)
- Reschedule or cancellation complete
- Escalation handed off
- Inquiry answered
- Waitlist confirmed
- Booking fallback note created
- Any task completed and no further action pending

**Entry**
Always ask first: "Is there anything else I can help you with today?"

**Logic**
1. If caller has another request: handle it (route to appropriate node), then return here.
2. If caller signals done or says no:
   - Booking confirmed / issue resolved & happy:
     "Thanks for calling {{ business_name }}, [name]! [Pet] is going to look amazing. Talk soon!"
   - Issue unresolved or caller stressed:
     "Thanks for calling [name]. Our team will be in touch soon. Take care!"
3. Call `end_call`.

Never call `end_call` without completing step 1 first.

**Tools**
- `end_call`

**Exits**
| Condition | Next Node |
|---|---|
| Caller has another request | Route to appropriate node, return to `CLOSE` after |
| Caller is done | `end_call` — conversation ends |

---

## Summary Table

| Node | ID | Type | Trigger | Exits to |
|---|---|---|---|---|
| `GREETING` | MF-01 | Main · Entry | Call begins, caller responds | `BOOKING` · `INQUIRY` · `PRICING` · `RESCHEDULE` · `CANCEL` · `ESCALATION` |
| `BOOKING` | MF-02 | Main | New booking intent | `CLOSE` · `WAITLIST OFFER` · `BOOKING FALLBACK` · `PRICING` · `ESCALATION` |
| `INQUIRY` | MF-03 | Main | General question intent | `CLOSE` · `BOOKING` · `PRICING` · `ESCALATION` |
| `ESCALATION` | GN-01 | **Global** | Complaint / human request / Tier 2 / unclear intent × 3 | `CLOSE` |
| `URGENT` | GN-02 | **Global** | Injury / emergency keywords | `CLOSE` |
| `RESCHEDULE` | GN-03 | **Global** | "Reschedule / change my appointment" intent | `CLOSE` · `ESCALATION` |
| `CANCEL` | GN-04 | **Global** | "Cancel / don't need it" intent | `CLOSE` · `ESCALATION` |
| `PRICING` | GN-05 | **Global** | Pricing / "how much" question at any point | `BOOKING` · `CLOSE` |
| `WAITLIST OFFER` | GN-06 | **Global** | No availability / slot too far / caller declines far slot | `CLOSE` · `BOOKING FALLBACK` |
| `BOOKING FALLBACK` | GN-07 | **Global** | Booking fails / service lookup fails / caller declines waitlist | `CLOSE` |
| `CLOSE` | GN-08 | **Global** | Any task completed | `end_call` |
