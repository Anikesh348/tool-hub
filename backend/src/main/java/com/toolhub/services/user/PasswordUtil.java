package com.toolhub.services.user;

import org.mindrot.jbcrypt.BCrypt;

public class PasswordUtil {
    public static String hashPassword(String unencryptedPassword) {
        return BCrypt.hashpw(unencryptedPassword, BCrypt.gensalt());
    }
    public static boolean checkPassword(String unencryptedPassword, String encryptedPassword) {
        return BCrypt.checkpw(unencryptedPassword, encryptedPassword);
    }
}
