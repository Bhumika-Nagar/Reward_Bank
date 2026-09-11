# RewardBank — Write-up

1.Assumptions

a. I assumed usage sessions are reported in whole minutes because the requirement charges one minute per minute

b. offline usage is processed using the child's current balance when the server receive it rather than reconstucting historical balance.this keeps behaviour simple ans deterministic.

c. Each usage session has a unique ID, so the same session can safely be retried without charging the child twice.

d. Debt is tracked separately from the available balance, so child can never have negative available balance.

e. The application currently uses SQLite and is designed as a single-process application as this assessment doesn't require distributed deployment and it keeps the transaction and ledger logic simple to reason about.

f. Batched usage sessions are processed in the order received inside one transaction. If any session in the batch is invalid, the whole batch is rejected and no partial usage or ledger entries are recorded.


2. What happens if the parent clicks the "approved" twice ?

The first approval request changes the task from DONE to APPROVED and adds the reward to the child's balance through a ledger entry.

If the same request arrives again 200ms later, the task is no longer in the DONE state. My approval logic checks the task status before adding the reward, so the second request is rejected with an error instead of creating another ledger entry.

For example, if the task reward is 20:

- First approval : balance increases by 20 and one TASK_APPROVED ledger entry is created
- Second approval : rejected because the task is already APPROVED
- Final balance : increased by only 20.

I also added a test for this case.

3. Two usage sessions exceed the remaining balance

Suppose the child has 10 minutes remaining and two apps report usage at roughly the same time.

For example:

- App A reports 7 minutes.
- App B reports 7 minutes.
- Total requested usage = 14 minutes, but the child only has 10 minutes.

The requests are processed inside a database transaction, so they cannot both spend the same balance.

If App A is processed first:

1. Starting balance = 10
2. App A uses 7 minutes → balance becomes 3
3. Ledger entry: -7 for USAGE
4. App B then has only 3 minutes available.
5. App B uses 3 minutes and the remaining 4 minutes are rejected.
6. Ledger entry: -3 for USAGE
7. Final balance = 0

So the ledger would effectively look like:

The important part is that the balance never goes negative and the total amount charged is never more than the available balance.

My current test covers two usage requests against the same child and verifies that the combined usage cannot exceed the starting balance. It models the requests arriving one after another; it is not a true multi-process concurrency test.

4. Undo approval

If a parent accidentally approves a task and the child has already spent some or all of that reward, I don't allow the child's balance to become negative.

For example, suppose a task gives 30 minutes:

- Parent approves the task : balance increases by 30.
- Child spends 20 minutes : balance is now 10.
- Parent then undoes the approval.
- I remove the remaining 10 minutes from the balance.
- The other 20 minutes have already been consumed, so I record 20 minutes as debt.

The result is:

- Available balance = 0
- Debt = 20

The deduction of the remaining 10 minutes is recorded as an UNDO_APPROVAL ledger entry. I don't put the debt itself in the ledger because debt is not an actual balance change.

When the child earns a future reward, the debt is paid first. For example, if the child later earns 30 minutes, 20 minutes repay the debt and only 10 minutes are added to the available balance.

I chose this because a parent should be able to undo an accidental approval without giving the child a negative available balance. At the same time, the system should not pretend that the 20 minutes already used never happened. Keeping that amount as debt preserves that history and makes future rewards repay it.

5. Scaling to 100,000 children

The first thing I would expect to become a problem is SQLite and the single-process design. It works well for this assessment, but with 100,000 children and usage events constantly coming in, a single SQLite database would become a bottleneck for concurrent writes.

I would first move the database to PostgreSQL. The ledger and balance updates would still happen inside database transactions, but PostgreSQL would give me much better support for concurrent requests and a larger workload.

I would also add proper indexes on frequently queried fields such as child_id, task IDs, and usage session IDs.

If the usage event volume became very high, I would separate receiving usage events from processing them using a queue. The API could accept the event quickly and workers could process the usage and update the balance.

So I wouldn't try to scale the current SQLite setup directly. My first step would be moving to PostgreSQL while keeping the same basic ledger and transaction design, and then introduce a queue if the usage-event volume required it.
