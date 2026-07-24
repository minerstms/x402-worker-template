/* eslint-disable */
interface MainnetEnv {
  PAYMENT_COORDINATOR: DurableObjectNamespace;
  /** Cloudflare secret binding for future bounded proof; not read by the disabled entry. */
  MAINNET_SELLER_ADDRESS?: string;
}
