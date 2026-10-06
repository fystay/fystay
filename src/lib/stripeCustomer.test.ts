import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { deleteStripeCustomer, getOrCreateStripeCustomer } from "./stripeCustomer";

type Row = { id: string; email: string; name: string; stripeCustomerId: string | null };
let user: Row;
let stripeCustomers: Map<string, { id: string; email: string; deleted?: boolean }>;
let createdByKey: Map<string, string>;
let nextId: number;

const db = {
  user: {
    findUniqueOrThrow: async () => ({ ...user }),
    updateMany: async ({ where, data }: { where: { stripeCustomerId: string | null }; data: { stripeCustomerId: string } }) => {
      if (user.stripeCustomerId !== where.stripeCustomerId) return { count: 0 };
      user.stripeCustomerId = data.stripeCustomerId;
      return { count: 1 };
    },
  },
} as unknown as Parameters<typeof getOrCreateStripeCustomer>[1];

// Mimics Stripe: a repeated idempotency key returns the first customer.
const stripe = {
  customers: {
    create: vi.fn(async (params: { email: string }, options: { idempotencyKey: string }) => {
      const existing = createdByKey.get(options.idempotencyKey);
      if (existing) return stripeCustomers.get(existing)!;
      const customer = { id: `cus_${nextId++}`, email: params.email };
      stripeCustomers.set(customer.id, customer);
      createdByKey.set(options.idempotencyKey, customer.id);
      return customer;
    }),
    retrieve: vi.fn(async (id: string) => {
      const customer = stripeCustomers.get(id);
      if (!customer) throw Object.assign(new Error("No such customer"), { code: "resource_missing" });
      return customer;
    }),
    update: vi.fn(async (id: string, params: { email: string }) => {
      stripeCustomers.get(id)!.email = params.email;
    }),
    del: vi.fn(async (id: string) => {
      if (!stripeCustomers.has(id)) throw Object.assign(new Error("No such customer"), { code: "resource_missing" });
      stripeCustomers.delete(id);
    }),
  },
} as unknown as Stripe;

beforeEach(() => {
  user = { id: "user_1", email: "ana@example.com", name: "Ana", stripeCustomerId: null };
  stripeCustomers = new Map();
  createdByKey = new Map();
  nextId = 1;
  vi.clearAllMocks();
});

describe("getOrCreateStripeCustomer", () => {
  it("creates a customer on the first payment, tagged with the FYStay user, and stores it", async () => {
    const id = await getOrCreateStripeCustomer(stripe, db, "user_1");
    expect(id).toBe("cus_1");
    expect(user.stripeCustomerId).toBe("cus_1");
    expect(stripe.customers.create).toHaveBeenCalledWith(
      { email: "ana@example.com", name: "Ana", metadata: { fystayUserId: "user_1" } },
      { idempotencyKey: expect.stringMatching(/^fystay-customer:user_1:new:/) },
    );
  });

  it("reuses the stored customer on every later payment", async () => {
    await getOrCreateStripeCustomer(stripe, db, "user_1");
    expect(await getOrCreateStripeCustomer(stripe, db, "user_1")).toBe("cus_1");
    expect(stripe.customers.create).toHaveBeenCalledTimes(1);
  });

  it("gives two checkouts started at once the same single customer", async () => {
    const [a, b] = await Promise.all([
      getOrCreateStripeCustomer(stripe, db, "user_1"),
      getOrCreateStripeCustomer(stripe, db, "user_1"),
    ]);
    expect(a).toBe("cus_1");
    expect(b).toBe("cus_1");
    expect(stripeCustomers.size).toBe(1);
  });

  it("replaces a stored customer that no longer exists in Stripe", async () => {
    user.stripeCustomerId = "cus_gone";
    const id = await getOrCreateStripeCustomer(stripe, db, "user_1");
    expect(id).toBe("cus_1");
    expect(user.stripeCustomerId).toBe("cus_1");
  });

  it("keeps the Stripe email in step with an email change", async () => {
    await getOrCreateStripeCustomer(stripe, db, "user_1");
    user.email = "ana.new@example.com";
    await getOrCreateStripeCustomer(stripe, db, "user_1");
    expect(stripeCustomers.get("cus_1")!.email).toBe("ana.new@example.com");
  });
});

describe("deleteStripeCustomer", () => {
  it("deletes, and treats an already-missing customer as done", async () => {
    await getOrCreateStripeCustomer(stripe, db, "user_1");
    await deleteStripeCustomer(stripe, "cus_1");
    expect(stripeCustomers.size).toBe(0);
    await expect(deleteStripeCustomer(stripe, "cus_1")).resolves.toBeUndefined();
  });
});
