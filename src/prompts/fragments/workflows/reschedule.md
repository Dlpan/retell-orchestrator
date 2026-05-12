# RESCHEDULE
1. Identify: Speak a holding line, then call get_upcoming_appointments. 0 results > ESCALATION (take-message). 1 result > confirm it back. Multiple > list briefly and ask which one. DO NOT call check_change_eligibility in this turn. Wait for the caller's spoken response.
2. Read result and branch using check_change_eligibility: { byId: { "<appointmentId>": { isFreeChange, hoursUntilStart } } }
- isFreeChange is true → FREE RESCHEDULE
- Any other case → SAY: "Since this one's coming up soon, our team will take care of getting it moved for you." → LATE RESCHEDULE

FREE RESCHEDULE:
- Say a short, natural bridge sentence.
- get_customer_addresses + get_all_staff_list + get_van_list, then smart_schedule (reuse existing petId / serviceIds / serviceDuration).
- Offer a specific slot following availability step rules.
- On confirm: reschedule_appointment.

LATE RESCHEDULE:
- Do NOT call reschedule_appointment.
- Collect preferred new timing + contact preference.
- create_chat (note: caller, pet, current appt, new timing, contact, reason if given) > create_specialist_task.
- Spoken close: "Our team will reach out shortly to reschedule."
