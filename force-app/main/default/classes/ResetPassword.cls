public with sharing class ResetPassword {

    @InvocableMethod(label='Set User Password by Email' description='Sets a new password for a user based on email address')
    public static void setPasswordByEmail(List<FlowInputs> inputList) {
        for(FlowInputs input : inputList) {
            // Step 1: Find the user with the provided email
            List<User> usersFound = [
                SELECT Id, Name, Email 
                FROM User 
                WHERE Email = :input.email 
                LIMIT 1
            ];

            // Step 2: If user exists, update the password
            if(!usersFound.isEmpty()) {
                User targetUser = usersFound[0];
                System.setPassword(targetUser.Id, input.newPassword);
                System.debug('Password updated successfully for user: ' + targetUser.Name);
            } else {
                System.debug('No user found with email: ' + input.email);
            }
        }
    }

    // Wrapper class for flow inputs
    public class FlowInputs {
        @InvocableVariable(label='User Email' required=true)
        public String email;

        @InvocableVariable(label='New Password' required=true)
        public String newPassword;
    }
}