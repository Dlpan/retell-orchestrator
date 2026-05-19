# Retell Conversation Flow — Implementation Setup Guide
# Business Type: [Mobile Grooming | Salon Grooming]
# Version: 1.0
# Reference: conversation-flow-global-nodes.md (design spec)

---

## Overview

This guide translates the conversation flow design spec into concrete Retell platform actions.
Follow each section in order. Each node entry tells you exactly:
- What to name it
- What type it is
- What instructions to put in
- Which tools to attach
- Which transitions/edges to wire up

**Total nodes to create: 11**
- 3 Main Flow Nodes (MF-01 to MF-03)
- 8 Global Nodes (GN-01 to GN-08)

---

## Prerequisites

Before building the flow, confirm the following are already in place:

| Item | Where to check |
|---|---|
| Retell Agent created | Agent settings |
| LLM configured (model + temperature) | Agent → LLM |
| All custom tools registered | Agent → Tools |
| `{{ working_hours }}`, `{{ service_area }}`, etc. all set as variables | Agent → Variables |
| Static greeting message recorded or set as TTS | Agent → Greeting |

**Tools that must be registered before flow build:**

| Tool name | Used in |
|---|---|
| `lookup_customer` | MF-01 |
| `extract_unique_caller_id` | MF-01 |
| `get_customer_settings` | MF-01 |
| `create_lead` / `update_lead` | MF-02 |
| `create_pet_for_lead` / `create_pet` | MF-02 |
| `get_customer_addresses` | MF-02 |
| `search_address` | MF-02 (Mobile) |
| `get_address` | MF-02 (Mobile) |
| `save_customer_address` | MF-02 (Mobile) |
| `get_applicable_services` | MF-02, GN-05 |
| `get_all_staff_list` | MF-02, GN-03 |
| `get_van_list` | MF-02, GN-03 |
| `smart_schedule` | MF-02, GN-03 |
| `create_appointment` | MF-02 |
| `get_upcoming_appointments` | GN-03, GN-04 |
| `check_change_eligibility` | GN-03, GN-04 |
| `reschedule_appointment` | GN-03 |
| `cancel_appointment` | GN-04 |
| `create_grooming_waitlist` | GN-06 |
| `create_chat` | GN-01, GN-03, GN-04, GN-05, GN-06, GN-07 |
| `create_specialist_task` | GN-01, GN-02, GN-03, GN-04, GN-06, GN-07 |
| `send_confirmation_sms` | GN-05 |
| `transfer_call` | GN-01 |
| `end_call` | GN-08 |

---

## Section 1 — Main Flow Nodes

---

### MF-01 · GREETING
**Node type:** Start Node (set as the entry point of the flow)
**Node name in Retell:** `GREETING`

**Instructions to paste into the node:**

```
When the caller responds to the static greeting, speak immediately — do not wait for any tool result:
"Thank you for calling {{ business_name }}. How can I help you today?"

At the same time, silently call lookup_customer using {{ user_number }} (the caller's ANI). Never use the business phone number. Do not announce the lookup.

When lookup_customer returns:
- MATCH: Confirm identity — "Am I speaking with [first name from profile]?"
  - If yes: "Hi [name]! Great to hear from you." → call extract_unique_caller_id + get_customer_settings (non-blocking).
  - If no / wrong person: treat as new lead, continue naturally.
- NO MATCH: Continue naturally. Do not mention that no profile was found.

Then detect the caller's intent and transition to the correct node.
```

**Tools to enable in this node:**
- `lookup_customer`
- `extract_unique_caller_id`
- `get_customer_settings`

**Transitions (Edges) to create:**

| Condition | Destination node |
|---|---|
| Caller wants to book a new appointment | `BOOKING` |
| Caller asks about pricing or "how much" | `PRICING` |
| Caller asks a general question | `INQUIRY` |
| Caller says "reschedule", "change my appointment", "move my appointment" | `RESCHEDULE` |
| Caller says "cancel", "cancel my appointment" | `CANCEL` |
| Caller complains, gives feedback, asks for a person, or intent unclear × 3 | `ESCALATION` |

---

### MF-02 · BOOKING
**Node type:** Regular Node
**Node name in Retell:** `BOOKING`

**Instructions to paste into the node:**

```
Handle the full new-appointment booking flow (Steps 1–7).

Step 1 — Lead Info (new callers only):
Collect first name and last name. Phone is already known from ANI — confirm only if needed.
As soon as both names are in hand, fire update_lead (if lead found) or create_lead (if no match). Non-blocking — fire in the same turn as your next question.

Step 2 — Pet Info (new callers only):
Collect one at a time: pet type → pet name → breed → gender → age → weight → coat type → health concerns (optional).
Call create_pet_for_lead with vaccineList as empty array [].

Step 3 — Address [Mobile Grooming only]:
For returning callers: call get_customer_addresses first.
- Address on file: confirm with caller → proceed.
- No address: ask → call search_address to resolve canonical version → confirm → call get_address (for lat/lng) → save_customer_address.

Step 4 — Service Selection:
- Returning caller with known last service: offer same service or different.
- New caller: recommend based on breed + weight + coat type.
Call get_applicable_services (serviceType=SERVICE) for service ID + duration.
Immediately fire a second get_applicable_services (serviceType=ADDON) in parallel.
If get_applicable_services fails or returns no results: go to BOOKING FALLBACK.

Step 5 — Add-ons:
Use pre-fetched add-on list from Step 4 — no new tool call.
- Add-ons available: offer exactly 2 based on pet history/condition.
- No add-ons / cat booking: skip to Step 6 silently.

Step 6 — Availability Check:
Call get_all_staff_list + get_van_list, then smart_schedule.
Make a specific slot offer — never ask "when are you free?"
Slot priority: preferred groomer (returning only) > sooner > later.
If no slots fit after second smart_schedule: transition to WAITLIST OFFER.

Multi-pet: after first pet Steps 4–5, ask "Do you have any other pets to include?" — collect full info, single create_appointment for all pets.

Step 7 — Confirm Booking:
Call create_appointment.
Spoken confirmation with groomer name, day, time, pet name, service.
If appointment > 7 days away: call create_specialist_task + tell caller you'll call if something opens sooner.
If create_appointment fails: transition to BOOKING FALLBACK.
```

**Tools to enable in this node:**
- `create_lead` / `update_lead`
- `create_pet_for_lead` / `create_pet`
- `get_customer_addresses`
- `search_address` *(Mobile only)*
- `get_address` *(Mobile only)*
- `save_customer_address`
- `get_applicable_services`
- `get_all_staff_list`
- `get_van_list`
- `smart_schedule`
- `create_appointment`
- `create_specialist_task`

**Transitions (Edges) to create:**

| Condition | Destination node |
|---|---|
| Booking confirmed | `CLOSE` |
| `smart_schedule` returns empty / caller says slot too far | `WAITLIST OFFER` |
| `get_applicable_services` fails or returns no results | `BOOKING FALLBACK` |
| `create_appointment` fails after retry | `BOOKING FALLBACK` |
| Caller hesitates ("I'll think about it") | Handled inline (Drop-off logic in instructions), then `CLOSE` |
| Caller asks about pricing mid-flow | `PRICING` |
| Caller complains or requests a human mid-flow | `ESCALATION` |

---

### MF-03 · INQUIRY
**Node type:** Regular Node
**Node name in Retell:** `INQUIRY`

**Instructions to paste into the node:**

```
Answer questions directly. Do not transfer or hold.

Tier 1 — AI handles end-to-end:
- Service menu and pricing: quote from Business Facts. If breed+weight known, call get_applicable_services for exact price. Otherwise size-based fallback ("starts at").
- Service duration: quote by breed/size from Business Facts.
- Availability check (no booking intent): run smart_schedule and share earliest slot — no commitment.
- [Mobile] Service area: confirm by zip or address.
- [Salon] Location, parking, arrival instructions, whether owner needs to stay, estimated wait: answer from Business Facts.
- General grooming FAQ: answer from {{ faq }}.

After every answer, steer toward booking:
"Want me to check availability for [pet] this week?"
If caller says yes: transition to BOOKING.

Tier 2 — Route to human:
- Pricing dispute or special pricing request → ESCALATION.
- Questions about a past service or incident → ESCALATION.
```

**Tools to enable in this node:**
- `get_applicable_services` *(for exact breed-based pricing)*
- `create_chat` + `send_confirmation_sms` *(if caller requests info via SMS)*
- `get_all_staff_list` · `get_van_list` · `smart_schedule` *(if availability check requested)*

**Transitions (Edges) to create:**

| Condition | Destination node |
|---|---|
| Caller wants to book after inquiry | `BOOKING` |
| Caller satisfied — no booking intent | `CLOSE` |
| Caller asks specifically about pricing | `PRICING` |
| Pricing dispute / past service question | `ESCALATION` |

---

## Section 2 — Global Nodes

> **How to create a Global Node in Retell:**
> In the conversation flow editor, create a node and toggle it to "Global". Set the trigger condition in the "Trigger" field. The node will auto-activate from any point in the flow when the condition is met.

---

### GN-01 · ESCALATION
**Node type:** Global Node
**Node name in Retell:** `ESCALATION`

**Trigger condition to set:**
```
Caller says "speak to someone", "talk to a person", "manager", "supervisor" — OR
caller expresses a complaint or frustration — OR
caller requests a modification the AI cannot complete — OR
AI has had 3 consecutive exchanges it cannot resolve
```

**Instructions to paste into the node:**

```
Match tone to context before acting:
- Complaint / frustration: "I'm so sorry to hear that — let me get someone from the team for you."
- Request for human: "Of course, let me connect you now."
- Unclear intent (3 strikes): "Let me get one of our team members to help you out."

During working hours ({{ working_hours }}):
1. Speak entry phrase.
2. Call transfer_call.
3. If transfer goes unanswered: "Our team is with other customers right now — I'll make sure they reach out to you shortly." → call create_specialist_task + create_chat (scenario, caller name, reason) → go to CLOSE.

Outside working hours:
1. Speak entry phrase adapted: "Our team isn't available right now, but I'll make sure they get back to you."
2. Collect callback number and any message.
3. Call create_specialist_task (scenario, caller name, callback number, message).
4. "I'll pass that along — they'll reach out to you soon." → go to CLOSE.
```

**Tools to enable:** `transfer_call` · `create_specialist_task` · `create_chat`

**Transitions (Edges):**

| Condition | Destination node |
|---|---|
| Transfer completed or message taken | `CLOSE` |

---

### GN-02 · URGENT
**Node type:** Global Node
**Node name in Retell:** `URGENT`

**Trigger condition to set:**
```
Any of these keywords appear: "injured", "bleeding", "emergency", "hurt", "sick", "accident" — or strong audible distress
```

**Instructions to paste into the node:**

```
Immediately and warmly: "I'm so sorry to hear that."
Do NOT attempt to book, ask follow-up questions, or transfer.

1. Speak entry phrase.
2. Silently call create_specialist_task with "URGENT" flag — include caller name, ANI, and verbatim context.
3. Spoken: "I'm flagging this for our team right now — they'll get back to you as soon as possible."
4. Go to CLOSE.
```

**Tools to enable:** `create_specialist_task`

**Transitions (Edges):**

| Condition | Destination node |
|---|---|
| Always | `CLOSE` |

---

### GN-03 · RESCHEDULE
**Node type:** Global Node
**Node name in Retell:** `RESCHEDULE`

**Trigger condition to set:**
```
Caller says "reschedule", "change my appointment", "move my appointment", "different day", "different time"
```

**Instructions to paste into the node:**

```
Entry: "Of course — let me pull up your upcoming appointments."

Step 1 — Identify the appointment:
Call get_upcoming_appointments.
- 0 results → "I'm not seeing an upcoming appointment on your account" → go to ESCALATION.
- 1 result → confirm it back to caller.
- Multiple → list briefly, ask which one.
Wait for caller's spoken confirmation before proceeding.

Step 2 — Check eligibility:
Call check_change_eligibility for the confirmed appointmentId.
Read byId[appointmentId].isFreeChange:
- true → FREE RESCHEDULE
- Any other case (false / missing / error) → LATE RESCHEDULE

FREE RESCHEDULE:
1. Short bridge phrase.
2. Call get_all_staff_list + get_van_list → smart_schedule (reuse existing petId / serviceIds / serviceDuration; use stored address coordinates or 0,0 for salon).
3. Offer a specific slot.
4. On confirmation: call reschedule_appointment.
5. Close the loop: spoken confirmation → create_chat (caller, pet, old appt, new appt) → create_specialist_task.
6. "Done! [Groomer] is now scheduled for [pet] on [new day] at [new time]." → go to CLOSE.

LATE RESCHEDULE:
1. "Since this one's coming up soon, our team will take care of getting it moved for you."
2. Collect preferred new timing + contact preference.
3. create_chat (caller, pet, current appt, new timing, contact, reason) → create_specialist_task.
4. "Our team will reach out shortly to get that rescheduled." → go to CLOSE.
```

**Tools to enable:** `get_upcoming_appointments` · `check_change_eligibility` · `get_all_staff_list` · `get_van_list` · `smart_schedule` · `reschedule_appointment` · `create_chat` · `create_specialist_task`

**Transitions (Edges):**

| Condition | Destination node |
|---|---|
| 0 upcoming appointments | `ESCALATION` |
| Reschedule completed (free or late) | `CLOSE` |
| `reschedule_appointment` fails after retry | `CLOSE` (treat as LATE — already handled inline) |
| `check_change_eligibility` fails | `CLOSE` (treat as LATE — already handled inline) |

---

### GN-04 · CANCEL
**Node type:** Global Node
**Node name in Retell:** `CANCEL`

**Trigger condition to set:**
```
Caller says "cancel", "cancel my appointment", "don't need it anymore"
```

**Instructions to paste into the node:**

```
Entry: "Of course — let me pull up your upcoming appointments."

Step 1 — Identify the appointment:
Call get_upcoming_appointments.
- 0 results → "I'm not seeing an upcoming appointment on your account" → go to ESCALATION.
- 1 or multiple → confirm which appointment with caller.

Step 2 — Check eligibility:
Call check_change_eligibility. Read byId[appointmentId].isFreeChange:
- true → FREE CANCEL
- Any other case → LATE CANCEL

FREE CANCEL:
1. Confirm exact appointment back to caller.
2. Ask reason warmly: "Do you mind sharing why — totally fine if not!"
3. Call cancel_appointment (normalized reason string).
4. Spoken confirmation → create_chat → create_specialist_task.
5. "Done! And whenever you're ready to rebook, we'd love to get [pet] back on the schedule." → go to CLOSE.

LATE CANCEL:
1. "Since this one's coming up soon, our team will handle the cancellation directly."
2. Collect cancellation reason.
3. create_chat (caller, pet, appt, reason) → create_specialist_task (flag as time-sensitive).
4. "Our team will confirm and follow up with you shortly." → go to CLOSE.
```

**Tools to enable:** `get_upcoming_appointments` · `check_change_eligibility` · `cancel_appointment` · `create_chat` · `create_specialist_task`

**Transitions (Edges):**

| Condition | Destination node |
|---|---|
| 0 upcoming appointments | `ESCALATION` |
| Cancellation completed (free or late) | `CLOSE` |
| `cancel_appointment` fails after retry | `CLOSE` (treat as LATE — already handled inline) |
| `check_change_eligibility` fails | `CLOSE` (treat as LATE — already handled inline) |

---

### GN-05 · PRICING
**Node type:** Global Node
**Node name in Retell:** `PRICING`

**Trigger condition to set:**
```
Caller asks about price, cost, or "how much" at any point in the conversation
```

**Instructions to paste into the node:**

```
Do not ask for the caller's name before quoting. Use existing profile data if available.

Priority order for quoting:
1. Profile with pet data from lookup_customer: call get_applicable_services (serviceType=SERVICE, petId from profile). Quote exact result — do NOT say "starting at".
2. Caller provided breed + weight, no saved profile: collect pet name only → create_lead (firstName={{ user_number }}, lastName=by_call) → create_pet_for_lead → get_applicable_services. Quote exact result.
3. Insufficient pet info: use size-based fallback from Business Facts. Say "starts at [price]".

After quoting: "Want me to check availability for [pet] this week?"
If caller wants to book: transition to BOOKING.

If caller requests pricing via SMS:
- Exact price: "Hi [name]! For [pet], [service] is [price]. [Mobile: We come right to your door! / Salon: We'd love to see [pet] at the salon!] Call {{ business_phone }} whenever you're ready."
- Generic fallback: "Hi [name]! [Service] starts at [price], with final pricing based on breed and weight. Call {{ business_phone }} whenever you're ready."
→ create_chat → send_confirmation_sms
```

**Tools to enable:** `get_applicable_services` · `create_lead` · `create_pet_for_lead` · `create_chat` · `send_confirmation_sms`

**Transitions (Edges):**

| Condition | Destination node |
|---|---|
| Caller wants to book after pricing | `BOOKING` |
| Caller satisfied, no booking intent | `CLOSE` |

---

### GN-06 · WAITLIST OFFER
**Node type:** Global Node
**Node name in Retell:** `WAITLIST OFFER`

**Trigger condition to set:**
```
smart_schedule returns empty or no available slots — OR
soonest available slot is more than {{ FAR_OUT_THRESHOLD }} days away — OR
caller explicitly says the available slot is too far out
```

**Instructions to paste into the node:**

```
Entry: "We do have a waitlist — cancellations come up often and you'd be first to know. Want me to add you?"

If caller agrees:
1. Collect one at a time:
   - Preferred timing or timeframe: "Is there a day or time of week that works best?"
   - Service (if not already confirmed)
   - Best contact method: "Is a call or text better for follow-up?"
2. Fire create_grooming_waitlist + create_specialist_task in parallel — do not wait for results before speaking.
3. "You're on the waitlist for [timing] — we'll reach out as soon as something opens up." → go to CLOSE.

If caller declines waitlist:
→ go to BOOKING FALLBACK.
```

**Tools to enable:** `create_grooming_waitlist` · `create_specialist_task`

**Transitions (Edges):**

| Condition | Destination node |
|---|---|
| Waitlist confirmed | `CLOSE` |
| Caller declines waitlist | `BOOKING FALLBACK` |

---

### GN-07 · BOOKING FALLBACK
**Node type:** Global Node
**Node name in Retell:** `BOOKING FALLBACK`

**Trigger condition to set:**
```
create_appointment fails after retry — OR
get_applicable_services returns no results or fails — OR
address cannot be resolved (Mobile) — OR
caller declines waitlist offer
```

**Instructions to paste into the node:**

```
Stay warm — do NOT reveal the system issue:
"I want to make sure we get [pet] on the calendar — let me grab a couple more details."

Collect the following one at a time (skip anything already known):
1. Preferred date or timeframe
2. Preferred groomer — ask only for returning customers; new customers = any
3. Best contact method (call or text)

Once all collected:
- create_chat with full detail note: caller name, pet name, service, address (Mobile), preferred timing, groomer preference, contact method
- create_specialist_task
- "Our team will be reaching out shortly to get [pet] on the schedule — we're really looking forward to taking care of them!" → go to CLOSE.
```

**Tools to enable:** `create_chat` · `create_specialist_task`

**Transitions (Edges):**

| Condition | Destination node |
|---|---|
| Always | `CLOSE` |

---

### GN-08 · CLOSE
**Node type:** Global Node
**Node name in Retell:** `CLOSE`

**Trigger condition to set:**
```
Any task is completed: booking confirmed, reschedule or cancellation complete, escalation handed off, inquiry answered, waitlist confirmed, fallback note created
```

**Instructions to paste into the node:**

```
Always ask first: "Is there anything else I can help you with today?"

1. If caller has another request: handle it (route to appropriate node), then return here.
2. If caller signals done or says no:
   - Booking confirmed / issue resolved & happy:
     "Thanks for calling {{ business_name }}, [name]! [Pet] is going to look amazing. Talk soon!"
   - Issue unresolved or caller stressed:
     "Thanks for calling [name]. Our team will be in touch soon. Take care!"
3. Call end_call.

Never call end_call without completing step 1 first.
```

**Tools to enable:** `end_call`

**Transitions (Edges):**

| Condition | Destination node |
|---|---|
| Caller has another request | Route to appropriate node, return to `CLOSE` after |
| Caller is done | `end_call` — conversation ends |

---

## Section 3 — Edge Wiring Summary

The table below is a complete reference of every edge in the flow. Use it to verify nothing is missing after building all nodes.

| From | Condition | To |
|---|---|---|
| `GREETING` | New booking intent | `BOOKING` |
| `GREETING` | Returning booking intent | `BOOKING` |
| `GREETING` | Pricing question | `PRICING` |
| `GREETING` | General question | `INQUIRY` |
| `GREETING` | Reschedule / change intent | `RESCHEDULE` |
| `GREETING` | Cancel intent | `CANCEL` |
| `GREETING` | Complaint / human request / unclear × 3 | `ESCALATION` |
| `BOOKING` | Booking confirmed | `CLOSE` |
| `BOOKING` | No slots / slot too far out | `WAITLIST OFFER` |
| `BOOKING` | Service lookup fails / no results | `BOOKING FALLBACK` |
| `BOOKING` | `create_appointment` fails | `BOOKING FALLBACK` |
| `BOOKING` | Pricing question mid-flow | `PRICING` |
| `BOOKING` | Complaint / human request | `ESCALATION` |
| `INQUIRY` | Caller wants to book | `BOOKING` |
| `INQUIRY` | Caller satisfied | `CLOSE` |
| `INQUIRY` | Pricing question | `PRICING` |
| `INQUIRY` | Dispute / past service | `ESCALATION` |
| `ESCALATION` | Transfer done / message taken | `CLOSE` |
| `URGENT` | Always | `CLOSE` |
| `RESCHEDULE` | 0 appointments found | `ESCALATION` |
| `RESCHEDULE` | Reschedule completed | `CLOSE` |
| `CANCEL` | 0 appointments found | `ESCALATION` |
| `CANCEL` | Cancellation completed | `CLOSE` |
| `PRICING` | Caller wants to book | `BOOKING` |
| `PRICING` | Caller satisfied | `CLOSE` |
| `WAITLIST OFFER` | Waitlist confirmed | `CLOSE` |
| `WAITLIST OFFER` | Caller declines waitlist | `BOOKING FALLBACK` |
| `BOOKING FALLBACK` | Always | `CLOSE` |
| `CLOSE` | Caller has another request | *(back to relevant node)* |
| `CLOSE` | Caller is done | `end_call` |

---

## Section 4 — Build Checklist

Use this checklist to confirm everything is in place before testing.

### Nodes created
- [ ] `GREETING` — set as **Start Node**
- [ ] `BOOKING`
- [ ] `INQUIRY`
- [ ] `ESCALATION` — set as **Global Node**
- [ ] `URGENT` — set as **Global Node**
- [ ] `RESCHEDULE` — set as **Global Node**
- [ ] `CANCEL` — set as **Global Node**
- [ ] `PRICING` — set as **Global Node**
- [ ] `WAITLIST OFFER` — set as **Global Node**
- [ ] `BOOKING FALLBACK` — set as **Global Node**
- [ ] `CLOSE` — set as **Global Node**

### Tools attached
- [ ] All tools from the Prerequisites table are registered
- [ ] Each node has only the tools it actually uses (no extras)

### Edges wired
- [ ] All edges from the Edge Wiring Summary table are connected
- [ ] No orphaned nodes (every node has at least one outgoing edge)
- [ ] `CLOSE` is reachable from every possible terminal state

### Trigger conditions set (Global Nodes)
- [ ] `ESCALATION` trigger covers: human request, complaint, unclear × 3
- [ ] `URGENT` trigger covers: injured / bleeding / emergency / hurt / sick / accident
- [ ] `RESCHEDULE` trigger covers: reschedule / change / move appointment
- [ ] `CANCEL` trigger covers: cancel / don't need it
- [ ] `PRICING` trigger covers: price / cost / how much
- [ ] `WAITLIST OFFER` trigger covers: no slots / far out / caller declines far slot
- [ ] `BOOKING FALLBACK` trigger covers: booking fails / service lookup fails
- [ ] `CLOSE` trigger covers: any task completed

### Variables configured
- [ ] `{{ business_name }}`
- [ ] `{{ business_id }}`
- [ ] `{{ user_number }}`
- [ ] `{{ current_date }}` · `{{ current_time }}` · `{{ timezone }}`
- [ ] `{{ working_hours }}`
- [ ] `{{ service_area }}`
- [ ] `{{ business_phone }}` · `{{ business_email }}`
- [ ] `{{ location }}`
- [ ] `{{ service_menu }}`
- [ ] `{{ faq }}`
- [ ] `{{ close_dates }}`
- [ ] `{{ booking_url }}`
- [ ] `{{ FAR_OUT_THRESHOLD }}`
- [ ] `MOBILE_GROOMING` or `SALON_GROOMING` flag
