## Teach-back

- Q1c: what happens when a phone's clock runs a day ahead? Misunderstood: Thought only times much later than the server are blocked; actually any editedAt later than server now is capped to now (not rejected), so the change is still applied with the server's time.
- Q1d: why updateMany with a lt condition instead of read-then-write? Misunderstood: Didn't know where updateMany is, what it does, or what lt means; missed that the database compares and writes in one atomic step, which avoids the read-then-write race.
- Q2b: the same create sent again for an id the caller already owns Misunderstood: Thought the server rejects it as a duplicate; it returns 200 with the existing project (idempotent), so the queue can drop the change.
- Q2c: two identical creates arriving concurrently Misunderstood: Thought the slower one is blocked with an error; the slower one hits P2002 on the primary key, the server catches it, re-runs createOnce and returns 200.
- Q3b: what the queue does with a rename answered 404 because the project was deleted Misunderstood: Thought the queue keeps running with that answer; it treats 404 as a permanent rejection, removes the change, reports it via onRejected and moves on to the next change.
- Q3d: how a 401 differs Misunderstood: Assumed a refresh-token flow (get a new token and retry); this app has no refresh token: a 401 means the session is gone, the queue keeps the change, the app returns to sign-in, and the change is sent after the same person signs in again.
