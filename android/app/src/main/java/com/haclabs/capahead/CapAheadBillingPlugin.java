package com.haclabs.capahead;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "CapAheadBilling")
public class CapAheadBillingPlugin extends Plugin implements PurchasesUpdatedListener {
  private static final String PRO_PRODUCT_ID = "capahead_pro";
  private BillingClient billingClient;
  private PluginCall pendingPurchaseCall;

  @Override
  public void load() {
    billingClient = BillingClient.newBuilder(getContext())
      .setListener(this)
      .enablePendingPurchases(
        PendingPurchasesParams.newBuilder()
          .enableOneTimeProducts()
          .build()
      )
      .build();
    connectBilling(null, null);
  }

  @PluginMethod
  public void getEntitlement(PluginCall call) {
    ensureBillingReady(() -> queryActiveSubscription(call), () -> resolveFreeEntitlement(call, "google_play_unavailable", -1, "Google Play Billing is not available."));
  }

  @PluginMethod
  public void purchase(PluginCall call) {
    String productId = call.getString("productId", PRO_PRODUCT_ID);
    String basePlanId = call.getString("basePlanId", "pro-monthly");
    if (!PRO_PRODUCT_ID.equals(productId)) {
      call.reject("Unknown product.");
      return;
    }
    ensureBillingReady(() -> launchSubscriptionPurchase(call, productId, basePlanId), () -> call.reject("Google Play Billing is not available."));
  }

  private void ensureBillingReady(Runnable readyAction, Runnable unavailableAction) {
    if (billingClient != null && billingClient.isReady()) {
      readyAction.run();
      return;
    }
    connectBilling(readyAction, unavailableAction);
  }

  private void connectBilling(Runnable readyAction, Runnable unavailableAction) {
    if (billingClient == null) {
      if (unavailableAction != null) unavailableAction.run();
      return;
    }
    billingClient.startConnection(new BillingClientStateListener() {
      @Override
      public void onBillingSetupFinished(BillingResult billingResult) {
        if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK && readyAction != null) {
          readyAction.run();
        } else if (unavailableAction != null) {
          unavailableAction.run();
        }
      }

      @Override
      public void onBillingServiceDisconnected() {
        // The next entitlement or purchase request will reconnect.
      }
    });
  }

  private void queryActiveSubscription(PluginCall call) {
    QueryPurchasesParams params = QueryPurchasesParams.newBuilder()
      .setProductType(BillingClient.ProductType.SUBS)
      .includeSuspendedSubscriptions(true)
      .build();

    billingClient.queryPurchasesAsync(params, (billingResult, purchases) -> {
      boolean active = false;
      boolean suspended = false;
      long purchaseTime = 0;

      if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
        for (Purchase purchase : purchases) {
          if (!purchase.getProducts().contains(PRO_PRODUCT_ID)) continue;
          if (purchase.getPurchaseState() != Purchase.PurchaseState.PURCHASED) continue;
          if (purchase.isSuspended()) {
            suspended = true;
            continue;
          }
          active = true;
          purchaseTime = Math.max(purchaseTime, purchase.getPurchaseTime());
          acknowledgeIfNeeded(purchase);
        }
      }

      JSObject result = new JSObject();
      result.put("isPro", active);
      result.put("source", "google_play");
      result.put("suspended", suspended);
      result.put("purchaseTime", purchaseTime);
      result.put("responseCode", billingResult.getResponseCode());
      result.put("debugMessage", billingResult.getDebugMessage());
      call.resolve(result);
    });
  }

  private void resolveFreeEntitlement(PluginCall call, String source, int responseCode, String debugMessage) {
    JSObject result = new JSObject();
    result.put("isPro", false);
    result.put("source", source);
    result.put("suspended", false);
    result.put("purchaseTime", 0);
    result.put("responseCode", responseCode);
    result.put("debugMessage", debugMessage);
    call.resolve(result);
  }

  private void launchSubscriptionPurchase(PluginCall call, String productId, String basePlanId) {
    QueryProductDetailsParams.Product product = QueryProductDetailsParams.Product.newBuilder()
      .setProductId(productId)
      .setProductType(BillingClient.ProductType.SUBS)
      .build();

    ArrayList<QueryProductDetailsParams.Product> products = new ArrayList<>();
    products.add(product);

    QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
      .setProductList(products)
      .build();

    billingClient.queryProductDetailsAsync(params, (billingResult, productDetailsResult) -> {
      if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
        call.reject("Could not load Google Play subscription: " + billingResult.getDebugMessage());
        return;
      }

      List<ProductDetails> detailsList = productDetailsResult.getProductDetailsList();
      if (detailsList == null || detailsList.isEmpty()) {
        call.reject("Google Play subscription is not available yet.");
        return;
      }

      ProductDetails details = detailsList.get(0);
      ProductDetails.SubscriptionOfferDetails selectedOffer = selectOffer(details, basePlanId);
      if (selectedOffer == null) {
        call.reject("Google Play base plan is not available yet.");
        return;
      }

      BillingFlowParams.ProductDetailsParams productDetailsParams =
        BillingFlowParams.ProductDetailsParams.newBuilder()
          .setProductDetails(details)
          .setOfferToken(selectedOffer.getOfferToken())
          .build();

      ArrayList<BillingFlowParams.ProductDetailsParams> productDetailsParamsList = new ArrayList<>();
      productDetailsParamsList.add(productDetailsParams);

      BillingFlowParams flowParams = BillingFlowParams.newBuilder()
        .setProductDetailsParamsList(productDetailsParamsList)
        .build();

      pendingPurchaseCall = call;
      BillingResult launchResult = billingClient.launchBillingFlow(getActivity(), flowParams);
      if (launchResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
        pendingPurchaseCall = null;
        call.reject("Could not open Google Play purchase: " + launchResult.getDebugMessage());
      }
    });
  }

  private ProductDetails.SubscriptionOfferDetails selectOffer(ProductDetails details, String basePlanId) {
    List<ProductDetails.SubscriptionOfferDetails> offers = details.getSubscriptionOfferDetails();
    if (offers == null || offers.isEmpty()) return null;
    ProductDetails.SubscriptionOfferDetails firstMatchingBasePlan = null;
    for (ProductDetails.SubscriptionOfferDetails offer : offers) {
      if (!basePlanId.equals(offer.getBasePlanId())) continue;
      if (firstMatchingBasePlan == null) firstMatchingBasePlan = offer;
      if (hasSevenDayFreeTrial(offer)) return offer;
    }
    return firstMatchingBasePlan != null ? firstMatchingBasePlan : offers.get(0);
  }

  private boolean hasSevenDayFreeTrial(ProductDetails.SubscriptionOfferDetails offer) {
    if (offer.getPricingPhases() == null || offer.getPricingPhases().getPricingPhaseList() == null) {
      return false;
    }
    for (ProductDetails.PricingPhase phase : offer.getPricingPhases().getPricingPhaseList()) {
      if (phase.getPriceAmountMicros() == 0 && "P7D".equals(phase.getBillingPeriod())) return true;
    }
    return false;
  }

  @Override
  public void onPurchasesUpdated(BillingResult billingResult, List<Purchase> purchases) {
    if (pendingPurchaseCall == null) return;

    if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) {
      boolean active = false;
      for (Purchase purchase : purchases) {
        if (!purchase.getProducts().contains(PRO_PRODUCT_ID)) continue;
        if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED && !purchase.isSuspended()) {
          active = true;
          acknowledgeIfNeeded(purchase);
        }
      }
      JSObject result = new JSObject();
      result.put("isPro", active);
      result.put("source", "google_play");
      pendingPurchaseCall.resolve(result);
    } else if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
      pendingPurchaseCall.reject("Purchase cancelled.");
    } else {
      pendingPurchaseCall.reject("Purchase failed: " + billingResult.getDebugMessage());
    }
    pendingPurchaseCall = null;
  }

  private void acknowledgeIfNeeded(Purchase purchase) {
    if (purchase.isAcknowledged()) return;
    AcknowledgePurchaseParams params = AcknowledgePurchaseParams.newBuilder()
      .setPurchaseToken(purchase.getPurchaseToken())
      .build();
    billingClient.acknowledgePurchase(params, billingResult -> {});
  }
}
