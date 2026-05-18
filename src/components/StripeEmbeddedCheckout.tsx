import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { useCallback } from "react";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createCheckoutSession, createCreditCheckoutSession } from "@/lib/payments.functions";

type Props = {
  priceId?: string;
  packageId?: string;
  customerEmail?: string;
  userId?: string;
  returnUrl?: string;
  mode?: "subscription" | "credits";
};

export function StripeEmbeddedCheckout({
  priceId,
  packageId,
  customerEmail,
  userId,
  returnUrl,
  mode = "subscription",
}: Props) {
  const fetchClientSecret = useCallback(async (): Promise<string> => {
    const targetReturnUrl = returnUrl || window.location.href;
    const secret =
      mode === "credits"
        ? await createCreditCheckoutSession({
            data: {
              packageId: packageId!,
              returnUrl: targetReturnUrl,
              environment: getStripeEnvironment(),
            },
          })
        : await createCheckoutSession({
            data: {
              priceId: priceId!,
              customerEmail,
              userId,
              returnUrl: targetReturnUrl,
              environment: getStripeEnvironment(),
            },
          });
    if (!secret) throw new Error("No client secret returned");
    return secret;
  }, [priceId, packageId, customerEmail, userId, returnUrl, mode]);

  return (
    <div id="checkout">
      <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
