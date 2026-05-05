public with sharing class PasswordValidatorFlow {

    public class PasswordData {
        @InvocableVariable(label='Password' required=true)
        public String password;
    }

    public class PasswordResult {
        @InvocableVariable(label='Is Valid')
        public Boolean isValid;
        
        @InvocableVariable(label='Message')
        public String message;
    }

    @InvocableMethod(label='Validate Password' description='Validates password complexity for Flow usage')
    public static List<PasswordResult> validatePassword(List<PasswordData> inputs) {
        List<PasswordResult> results = new List<PasswordResult>();
        
        for (PasswordData input : inputs) {
            PasswordResult res = new PasswordResult();
            
            String pwd = input.password;
            
            if (String.isBlank(pwd)) {
                res.isValid = false;
                res.message = 'Password cannot be blank.';
            } else if (pwd.length() < 8) {
                res.isValid = false;
                res.message = 'Password must be at least 8 characters long.';
            } else if (!Pattern.matches('.*[A-Z].*', pwd)) {
                res.isValid = false;
                res.message = 'Password must contain at least one uppercase letter.';
            } else if (!Pattern.matches('.*[a-z].*', pwd)) {
                res.isValid = false;
                res.message = 'Password must contain at least one lowercase letter.';
            } else if (!Pattern.matches('.*[0-9].*', pwd)) {
                res.isValid = false;
                res.message = 'Password must contain at least one number.';
            } else if (!Pattern.matches('.*[!@#$%^&*(),.?":{}|<>].*', pwd)) {
                res.isValid = false;
                res.message = 'Password must contain at least one special character.';
            } else {
                res.isValid = true;
                res.message = 'Password is valid.';
            }

            results.add(res);
        }
        return results;
    }
}