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
export interface IntakeContextResponseDto {
  displayName?: string;
  accountName?: string;
  devices: IntakeDeviceDto[];
  shipTo: {
    city?: string;
    state?: string;
    country?: string;
  };
}
