package com.toolhub.models.moviehubautomation;

import io.vertx.core.json.JsonObject;

public class UserChatInput {
    String conversationId;
    String userInput;

    public String getConversationId() {
        return conversationId;
    }

    public void setConversationId(String conversationId) {
        this.conversationId = conversationId;
    }

    public String getUserInput() {
        return userInput;
    }

    public void setUserInput(String userInput) {
        this.userInput = userInput;
    }

    public static UserChatInput fromJson(JsonObject res) throws IllegalArgumentException {
        Object conversationId = res.getValue("conversationId");
        Object userInput = res.getValue("userInput");
        if (!(conversationId instanceof String)
                || ((String) conversationId).isEmpty()
            || !(userInput instanceof  String)
                || (((String) userInput).isEmpty())) {
            throw new IllegalStateException("invalid payload");
        }
        UserChatInput userChatInput = new UserChatInput();
        userChatInput.setUserInput(userInput.toString());
        userChatInput.setConversationId(conversationId.toString());
        return userChatInput;
    }
}
