/**
 * @description Unit tests for AccountMapSelector.
 *              Uses @TestSetup to create shared test data once per test class execution.
 *              Tests cover both the anchor account lookup and the radius-based query.
 *
 * @author      Salesforce Developer
 * @since       2026
 */
@IsTest
public with sharing class AccountMapSelectorTest {
  // ─── Test Data Constants ──────────────────────────────────────────────────

  private static final String ANCHOR_NAME = 'Test Anchor Account';
  private static final String NEARBY_NAME = 'Test Nearby Account';
  private static final String FAR_NAME = 'Test Far Account';
  private static final Decimal ANCHOR_LAT = 37.7749;
  private static final Decimal ANCHOR_LON = -122.4194;
  // ~5 miles from anchor (San Francisco to nearby point)
  private static final Decimal NEARBY_LAT = 37.8044;
  private static final Decimal NEARBY_LON = -122.2712;
  // ~100 miles from anchor (San Francisco to Fresno area)
  private static final Decimal FAR_LAT = 36.7378;
  private static final Decimal FAR_LON = -119.7871;

  // ─── Test Setup ───────────────────────────────────────────────────────────

  /**
   * @description Creates three test Account records: one anchor, one nearby, and one far.
   */
  @TestSetup
  static void makeData() {
    List<Account> accounts = new List<Account>{
      buildAccount(ANCHOR_NAME, ANCHOR_LAT, ANCHOR_LON),
      buildAccount(NEARBY_NAME, NEARBY_LAT, NEARBY_LON),
      buildAccount(FAR_NAME, FAR_LAT, FAR_LON)
    };
    insert accounts;
  }

  // ─── Tests: findAnchorAccountByName ──────────────────────────────────────

  /**
   * @description Verifies that findAnchorAccountByName returns the correct account
   *              when an exact matching name with shipping coordinates exists.
   */
  @IsTest
  static void findAnchorAccountByName_matchFound_returnsAccount() {
    AccountMapSelector selector = new AccountMapSelector();

    Test.startTest();
    Account result = selector.findAnchorAccountByName(ANCHOR_NAME);
    Test.stopTest();

    Assert.isNotNull(result, 'Expected a matching account to be returned.');
    Assert.areEqual(
      ANCHOR_NAME,
      result.Name,
      'Account name should match the search term.'
    );
  }

  /**
   * @description Verifies that findAnchorAccountByName returns null when no account
   *              matches the given name.
   */
  @IsTest
  static void findAnchorAccountByName_noMatch_returnsNull() {
    AccountMapSelector selector = new AccountMapSelector();

    Test.startTest();
    Account result = selector.findAnchorAccountByName(
      'Nonexistent Account XYZ'
    );
    Test.stopTest();

    Assert.isNull(
      result,
      'Expected null when no account matches the search term.'
    );
  }

  // ─── Tests: findAccountsWithinRadius ─────────────────────────────────────

  /**
   * @description Verifies that only accounts within the radius are returned.
   *              A 50-mile radius from the anchor should include NEARBY but exclude FAR.
   */
  @IsTest
  static void findAccountsWithinRadius_50Miles_includesNearbyExcludesFar() {
    AccountMapSelector selector = new AccountMapSelector();

    Test.startTest();
    List<Account> results = selector.findAccountsWithinRadius(
      ANCHOR_LAT,
      ANCHOR_LON,
      50
    );
    Test.stopTest();

    Set<String> names = extractNames(results);
    Assert.isTrue(
      names.contains(NEARBY_NAME),
      'Nearby account should be within 50 miles.'
    );
    Assert.isFalse(
      names.contains(FAR_NAME),
      'Far account should NOT be within 50 miles.'
    );
  }

  /**
   * @description Verifies that an empty list is returned when the radius is zero.
   */
  @IsTest
  static void findAccountsWithinRadius_zeroRadius_returnsEmpty() {
    AccountMapSelector selector = new AccountMapSelector();

    Test.startTest();
    List<Account> results = selector.findAccountsWithinRadius(
      ANCHOR_LAT,
      ANCHOR_LON,
      0
    );
    Test.stopTest();

    Assert.isTrue(
      results.isEmpty(),
      'Expected no results for a zero-mile radius.'
    );
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * @description Builds a test Account with shipping latitude and longitude populated.
   *
   * @param  name      Account name.
   * @param  lat       Shipping latitude.
   * @param  lon       Shipping longitude.
   * @return           Unsaved Account sObject.
   */
  private static Account buildAccount(String name, Decimal lat, Decimal lon) {
    return new Account(
      Name = name,
      ShippingStreet = '123 Test St',
      ShippingCity = 'Test City',
      ShippingState = 'CA',
      ShippingPostalCode = '94102',
      ShippingCountry = 'US',
      ShippingLatitude = lat,
      ShippingLongitude = lon,
      Phone = '415-555-0100',
      AnnualRevenue = 1000000
    );
  }

  /**
   * @description Extracts account names from a list of account records into a Set.
   *
   * @param  accounts  List of Account sObjects.
   * @return           Set of account names.
   */
  private static Set<String> extractNames(List<Account> accounts) {
    Set<String> names = new Set<String>();
    for (Account a : accounts) {
      names.add(a.Name);
    }
    return names;
  }
}
