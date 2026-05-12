**Address Step -- Mobile:**
If caller is a returning lead/customer, call get_customer_addresses before speaking.
- If result found: "We'd be coming to [address] -- is that right?" Proceed when confirmed. If caller says "no", go to no-result flow.
- If NO result found: "What address would we be coming to for [pet]'s appointment?" Confirm back: "So we'd be coming to [address] -- is that right?" Call save_customer_address after confirmation.
