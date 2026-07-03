/** A device offered to the customer in the intake picker (serial withheld). */
export interface IntakeDeviceDto {
  assetId: string;
  label: string;
  product?: string;
}

/**
 * Customer-safe intake context fetched from Salesforce after OTP verify, so
 * the assistant can greet by name and the user can pick a device instead of
 * typing account/asset details.
 */
export interface IntakeLocationDto {
  city?: string;
  state?: string;
  country?: string;
}

export interface IntakeContextResponseDto {
  displayName?: string;
  accountName?: string;
  /** Verified contact email on file (customer-safe; used for confirmation). */
  contactEmail?: string;
  devices: IntakeDeviceDto[];
  shipTo: IntakeLocationDto;
  /** Billing address when it differs from the default ship-to. */
  billingLocation?: IntakeLocationDto;
  /** True when billing and shipping addresses differ on the Account. */
  hasMultipleServiceLocations?: boolean;
}
