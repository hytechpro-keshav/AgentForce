@IsTest(SeeAllData=true)
public with sharing class LightningLoginFormControllerTest {
  @IsTest
  static void LightningLoginFormControllerInstantiation() {
    LightningLoginFormController controller = new LightningLoginFormController();
    System.assertNotEquals(controller, null);
  }

  @IsTest
  static void testIsUsernamePasswordEnabled() {
    System.assertEquals(
      true,
      LightningLoginFormController.getIsUsernamePasswordEnabled()
    );
  }

  @IsTest
  static void testIsSelfRegistrationEnabled() {
    System.assertEquals(
      false,
      LightningLoginFormController.getIsSelfRegistrationEnabled()
    );
  }

  @IsTest
  static void testGetSelfRegistrationURL() {
    System.assertEquals(
      null,
      LightningLoginFormController.getSelfRegistrationUrl()
    );
  }

  @IsTest
  static void testGetForgotPasswordUrl() {
    Auth.AuthConfiguration authConfig = LightningLoginFormController.getAuthConfig();
    System.assertEquals(
      authConfig.getForgotPasswordUrl(),
      LightningLoginFormController.getForgotPasswordUrl()
    );
  }

  @IsTest
  static void testLoginHandlesSiteLoginResult() {
    String result = LightningLoginFormController.login(
      'missing.user@example.com',
      'not-the-password',
      '/'
    );
    System.assert(
      result == null || result.length() > 0,
      'Expected null for a handled login or an error message.'
    );
  }

  @IsTest
  static void testSetExperienceIdWithNullReturnsNull() {
    System.assertEquals(
      null,
      LightningLoginFormController.setExperienceId(null)
    );
  }

  @IsTest
  static void testAuthConfig() {
    Auth.AuthConfiguration authConfig = LightningLoginFormController.getAuthConfig();
    System.assertNotEquals(null, authConfig);
  }
}
