import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { useCallback } from "react";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createCheckoutSession } from "@/lib/payments.functions";

interface Props {
  priceId: string;
  customerEmail?: string;
  userId?: string;
  returnUrl?: string;
}

export function StripeEmbeddedCheckout({ priceId, customerEmail, userId, returnUrl }: Props) {
  const fetchClientSecret = useCallback(async (): Promise<string> => {
    const secret = await createCheckoutSession({
      data: {
        priceId,
        customerEmail,
        userId,
        returnUrl: returnUrl || window.location.href,
        environment: getStripeEnvironment(),
      },
    });
    if (!secret) throw new Error("No client secret returned");
    return secret;
  }, [priceId, customerEmail, userId, returnUrl]);

  return (
    <div id="checkout">
      <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
