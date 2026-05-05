public class UnlockUser {
    @InvocableMethod(label='Unlock Salesforce User by Email')
    public static void unlockUserByEmail(List<String> emailList) {
        // Validate input
        if (emailList == null || emailList.isEmpty()) {
            System.debug('No email provided.');
            return;
        }

        String inputEmail = emailList[0];

        // Fetch the user by email
        List<User> userList = [SELECT Id, Name, Email FROM User WHERE Email = :inputEmail LIMIT 1];

        if (userList.isEmpty()) {
            System.debug('No user found with email: ' + inputEmail);
            return;
        }

        User targetUser = userList[0];
        Id userId = targetUser.Id;

        // Check if the user is locked
        Boolean isLocked = approval.isLocked(userId);

        if (isLocked) {
            System.debug('User is locked. Unlocking user: ' + targetUser.Name);
            approval.unlock(userId);
            System.debug('User unlocked successfully.');
        } else {
            System.debug('User is not locked: ' + targetUser.Name);
        }
    }
}