import { migrate, pool } from "./index.ts";

const customers: [number, string, string][] = [
  [1, "Asha Patil", "asha@example.com"],
  [2, "Rohan Mehta", "rohan@example.com"],
  [3, "Priya Nair", "priya@example.com"],
  [4, "Vikram Singh", "vikram@example.com"],
  [5, "Neha Kapoor", "neha@example.com"],
];

// [id, customer_id, status, total_inr]
const orders: [number, number, string, string][] = [
  [1001, 1, "shipped", "1499.00"],
  [1002, 1, "delivered", "799.00"],
  [1003, 2, "delivered", "2499.00"],
  [1004, 2, "processing", "349.00"],
  [1005, 3, "shipped", "1299.00"],
  [1006, 3, "delivered", "999.00"],
  [1007, 4, "delivered", "4999.00"],
  [1008, 4, "cancelled", "599.00"],
  [1009, 5, "delivered", "1200.00"],
  [1010, 5, "shipped", "2199.00"],
];

// One ticket per path. Ids are 1-6 after a seed.
const tickets: [string, string, string][] = [
  // 1. safe reply
  ["asha@example.com", "Where is my order?", "Hi, can you tell me where order 1001 is right now? Thanks, Asha"],
  // 2. refund
  ["rohan@example.com", "Wrong item, please refund", "Order 1003 arrived with the wrong item inside. I'd like a full refund of 2499.00 please."],
  // 3. spam
  ["promo@cheap-meds.biz", "You won a prize!!!", "Click http://cheap-meds.biz/claim to collect your free prize. Limited time offer."],
  // 4. complaint
  ["priya@example.com", "Terrible service", "This is the third time my order 1005 has been late and nobody answers my emails. I am very unhappy."],
  // 5. an order that belongs to someone else (1002 is Asha's)
  ["vikram@example.com", "Order status", "Can you check on order 1002 for me? I want to know if it was delivered."],
  // 6. refund above the order total (1009 totals 1200.00)
  ["neha@example.com", "Refund for order 1009", "I want a refund of 5000.00 for order 1009, it was damaged."],
];

export async function seed(): Promise<void> {
  await migrate();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "TRUNCATE audit_log, approvals, refunds, tickets, orders, customers RESTART IDENTITY",
    );
    // A fresh database means no stale paused threads either.
    for (const t of ["checkpoint_writes", "checkpoint_blobs", "checkpoints"]) {
      await client.query(`DO $$ BEGIN IF to_regclass('${t}') IS NOT NULL THEN TRUNCATE ${t}; END IF; END $$`);
    }
    for (const c of customers) {
      await client.query("INSERT INTO customers (id, name, email) VALUES ($1,$2,$3)", c);
    }
    for (const o of orders) {
      await client.query("INSERT INTO orders (id, customer_id, status, total_inr) VALUES ($1,$2,$3,$4)", o);
    }
    for (const t of tickets) {
      await client.query("INSERT INTO tickets (from_email, subject, body) VALUES ($1,$2,$3)", t);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

if (import.meta.main) {
  await seed();
  console.log(`seeded ${customers.length} customers, ${orders.length} orders, ${tickets.length} tickets`);
  await pool.end();
}
