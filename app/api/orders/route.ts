import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Razorpay from "razorpay";
import Order from "@/models/Order";
import { connectToDatabase } from "@/lib/db";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { productId, variant } = await req.json();
    await connectToDatabase();

    // Create Razorpay order
    const order = await razorpay.orders.create({
      amount: Math.round(variant.price * 100),
      currency: "USD",
      receipt: `receipt_${Date.now()}`,
      notes: {
        productId: productId.toString(),
      },
    });

    const newOrder = await Order.create({
      userId: session.user.id,
      productId,
      variant,
      razorpayOrderId: order.id,
      amount: variant.price,
      status: "pending", // Initial status is pending
    });

    return NextResponse.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      dbOrderId: newOrder._id,
    });
  } catch (error) {
    console.error("Error creating order:", error);
    return NextResponse.json(
      { error: "Failed to create order" },
      { status: 500 }
    );
  }
}

// This is an example of handling the webhook for updating payment status
export async function PATCH(req: NextRequest) {
  try {
    // Read the raw body from the request
    const rawBody = await req.text(); // Get the raw body as text
    const { razorpayOrderId, paymentId, signature } = await req.json();

    // Verify payment signature with Razorpay
    const isSignatureValid = Razorpay.validateWebhookSignature(
      rawBody,
      signature,
      process.env.RAZORPAY_WEBHOOK_SECRET!
    );

    if (!isSignatureValid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    // Find the order in your database
    const order = await Order.findOne({ razorpayOrderId });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Update the status based on payment outcome
    if (paymentId && isSignatureValid) {
      // Payment successful
      order.status = "successful";
    } else {
      // Payment failed
      order.status = "failed";
    }

    await order.save();

    return NextResponse.json({ message: "Order updated successfully" });
  } catch (error) {
    console.error("Error processing payment:", error);
    return NextResponse.json(
      { error: "Failed to update order" },
      { status: 500 }
    );
  }
}
