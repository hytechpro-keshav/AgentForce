/**
 * @description Selector class responsible for all SOQL queries related to the Account Map feature.
 *              Follows the selector pattern: one class owns all SOQL for a given object/feature.
 *              Uses WITH USER_MODE to enforce object-level and field-level security automatically.
 *              All query methods are designed to be bulkification-safe (no SOQL inside loops).
 *
 * @author      Salesforce Developer
 * @since       2026
 */
public with sharing class AccountMapSelector {
  /** Maximum number of nearby accounts to return to the map component. */
  private static final Integer MAX_RESULTS = 500;

  /**
   * @description Returns a single Account record that exactly matches the given name.
   *              The name value must already be sanitized (escapeSingleQuotes) by the caller.
   *
   * @param  sanitizedName  The account name string, already sanitized.
   * @return                The first matching Account, or null if none found.
   */
  public Account findAnchorAccountByName(String sanitizedName) {
    List<Account> results = [
      SELECT Id, Name, ShippingLatitude, ShippingLongitude
      FROM Account
      WHERE
        Name = :sanitizedName
        AND ShippingLatitude != NULL
        AND ShippingLongitude != NULL
      WITH USER_MODE
      LIMIT 1
    ];
    return results.isEmpty() ? null : results[0];
  }

  /**
   * @description Returns up to MAX_RESULTS Account records whose ShippingAddress
   *              falls within the specified radius (in miles) of the given lat/lng point.
   *
   * @param  latitude   Latitude of the centre point.
   * @param  longitude  Longitude of the centre point.
   * @param  radiusMiles Search radius in miles.
   * @return            List of matching Account records (may be empty, never null).
   */
  public List<Account> findAccountsWithinRadius(
    Decimal latitude,
    Decimal longitude,
    Integer radiusMiles
  ) {
    if (
      latitude == null ||
      longitude == null ||
      radiusMiles == null ||
      radiusMiles <= 0
    ) {
      return new List<Account>();
    }

    return [
      SELECT
        Id,
        Name,
        AnnualRevenue,
        Phone,
        ShippingStreet,
        ShippingCity,
        ShippingState,
        ShippingPostalCode,
        ShippingCountry,
        ShippingLatitude,
        ShippingLongitude
      FROM Account
      WHERE
        DISTANCE(
          ShippingAddress,
          GEOLOCATION(:latitude, :longitude),
          'mi'
        ) < :radiusMiles
        AND ShippingLatitude != NULL
        AND ShippingLongitude != NULL
      WITH USER_MODE
      ORDER BY
        DISTANCE(ShippingAddress, GEOLOCATION(:latitude, :longitude), 'mi') ASC
      LIMIT :MAX_RESULTS
    ];
  }
}
