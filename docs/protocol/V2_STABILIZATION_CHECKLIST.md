# V2 STABILIZATION CHECKLIST

This document is the practical working checklist for stabilizing the `v2` encrypted chat flow before removing `v1`.

The goal is simple:

1. make `v2` reliable on clean state
2. verify recovery and restart behavior
3. remove the need for runtime `v1` fallback
4. delete `v1`

---

## 1. Current Intent

We are in development mode.

- old chats are disposable
- test databases can be cleared
- AsyncStorage can be wiped
- preserving legacy `v1` conversations is not a project goal

Because of that, the correct strategy is:

- stabilize `v2` first
- fail loudly on `v2` issues
- remove `v1` only after the main `v2` scenarios stay green

---

## 2. Exit Criteria

`v2` is considered stable enough to begin deleting `v1` only when all of the following are true:

- first message in a brand new chat decrypts correctly
- first reply decrypts correctly
- reopening chat shows correct history
- full app restart preserves decryptability
- receiver-offline flow works
- local session reset is recoverable
- history replay does not degrade into `[Encrypted ...]` or `[decrypt failed ...]`
- normal usage no longer depends on `v1` fallback

---

## 3. Test Preparation

Before running a clean stabilization cycle:

- restart `chats-server`
- clear test MongoDB data if needed
- clear app data / AsyncStorage on both test clients
- login fresh on both devices/emulators
- use two dedicated test users

Recommended test labels:

- `A` = initiator
- `B` = receiver

---

## 4. Smoke Tests

These are the minimum tests that must pass before moving further.

### 4.1 New Chat First Message

Scenario:

1. `A` opens chat with `B`
2. `A` sends the first message

Expected:

- `B` sees plaintext immediately
- no `[Encrypted ...]`
- no decrypt error in logs
- receiver session is created successfully

Status:

- [ ] pass

### 4.2 First Reply

Scenario:

1. after receiving first message, `B` replies
2. `A` receives the reply

Expected:

- `A` sees plaintext immediately
- no `[decrypt failed ...]`
- ratchet stays in sync

Status:

- [ ] pass

### 4.3 Several Sequential Messages

Scenario:

1. `A` sends 3 to 5 messages in a row
2. `B` sends 3 to 5 messages in a row

Expected:

- every message decrypts
- no visible gaps
- no chain desync

Status:

- [ ] pass

---

## 5. History and Restart Tests

### 5.1 Reopen Chat Screen

Scenario:

1. exchange several messages
2. leave chat screen
3. open the same chat again

Expected:

- all recent messages still decrypt
- history order remains correct
- no history placeholders where plaintext should exist

Status:

- [ ] pass

### 5.2 Full App Restart

Scenario:

1. exchange several messages
2. fully kill the app
3. reopen app
4. open the chat again

Expected:

- session loads correctly
- history decrypts correctly
- new outgoing and incoming messages still work

Status:

- [ ] pass

### 5.3 Restart Both Sides

Scenario:

1. exchange messages
2. fully restart app on both `A` and `B`
3. open chat and continue messaging

Expected:

- both sides preserve working ratchet state
- history and new messages still decrypt

Status:

- [ ] pass

---

## 6. Offline and Delayed Delivery Tests

### 6.1 Receiver Offline For First Message

Scenario:

1. `B` is offline
2. `A` sends first message of a new chat
3. `B` comes online later
4. `B` opens the chat

Expected:

- bootstrap material is still sufficient
- history replay creates responder session if needed
- first message decrypts when `B` opens chat

Status:

- [ ] pass

### 6.2 Receiver Offline For Later Messages

Scenario:

1. session already exists
2. `B` goes offline
3. `A` sends more messages
4. `B` returns later

Expected:

- delayed messages decrypt correctly
- no counter drift beyond expected limits

Status:

- [ ] pass

### 6.3 Delayed UI History Load

Scenario:

1. send messages
2. do not open chat immediately on receiver
3. open it later through history path

Expected:

- history path produces same decrypt result as realtime path

Status:

- [ ] pass

---

## 7. Recovery Tests

### 7.1 Wipe One Client Local Storage

Scenario:

1. establish chat and exchange messages
2. wipe app data only on `B`
3. login `B` again
4. open chat

Expected:

- current behavior is understood and documented
- if recovery is not automatic yet, failure mode is clear and recoverable

Status:

- [ ] pass
- [ ] failure mode documented

### 7.2 Manual Session Reset

Scenario:

1. create a deliberate mismatch or wipe session state
2. trigger chat reset flow
3. establish secure chat again

Expected:

- chat can recover without reinstalling everything
- session reset behavior is explicit

Status:

- [ ] pass

### 7.3 Clear Server Test Data + Recreate Chat

Scenario:

1. clear message data
2. clear client app data
3. recreate conversation from zero

Expected:

- clean-state bootstrap works repeatedly
- no hidden dependency on stale state

Status:

- [ ] pass

---

## 8. History Decryption Quality Checks

These checks are specifically about the experience after loading stored messages.

### 8.1 No Placeholder Regressions

Check:

- no `[Encrypted v21]`
- no `[Encrypted v22]`
- no `[Encrypted v23]`
- no `[Decrypt failed v21]`
- no `[Decrypt failed v22]`

Status:

- [ ] pass

### 8.2 Directional Key Lookup Is Correct

Check:

- outgoing history decrypts correctly
- incoming history decrypts correctly
- no direction mismatch between stored keys and message metadata

Status:

- [ ] pass

### 8.3 History Order Safety

Check:

- messages sorted oldest to newest before replay-sensitive decrypt logic
- no decrypt regressions caused by pagination order or UI merge order

Status:

- [ ] pass

---

## 9. Logging and Diagnostics Checklist

Before removing `v1`, logs should be useful enough to debug real failures.

### 9.1 Required Diagnostics

- [ ] session creation logged
- [ ] bootstrap usage logged
- [ ] decrypt failure paths logged
- [ ] history replay failures logged
- [ ] ratchet transitions logged

### 9.2 Logging Hygiene

- [ ] no plaintext in logs
- [ ] no full secret material in logs
- [ ] debug logs can later be replaced with structured diagnostics

---

## 10. V1 Removal Readiness

Do not remove `v1` yet unless all of these are true:

- [ ] smoke tests are green
- [ ] history tests are green
- [ ] restart tests are green
- [ ] offline tests are green
- [ ] at least one recovery path is understood
- [ ] no silent runtime fallback to `v1` remains
- [ ] remaining `v1` code is only dead-weight compatibility code

Once all are green, the next step is:

1. remove `v1` send path
2. remove `v1` decrypt path
3. simplify DTOs and protocol policy
4. delete legacy branches from history handling
5. clean roadmap to reflect `v2-only`

---

## 11. Current Immediate Next Steps

This is the recommended order right now:

1. run clean-state smoke tests
2. fix first failing `v2` scenario
3. rerun from clean state
4. verify restart and history replay
5. verify offline receiver flow
6. verify reset/recovery behavior
7. only then begin deleting `v1`

---

## 12. Working Notes

Use this section during testing.

### Last Test Date

- 

### Latest Failing Scenario

- 

### Hypothesis

- 

### Fix Applied

- 

### Retest Result

- 
