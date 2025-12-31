package com.toolhub.services.moviehubautomation.intentparser;

import com.toolhub.enums.moviehubautomation.Intent;
import com.toolhub.models.moviehubautomation.ConversationContext;
import com.toolhub.models.moviehubautomation.IntentResponse;
import io.vertx.core.Future;

public interface IntentStrategy {


    Intent getIntent();

    Future<IntentResponse> automate(ConversationContext context, String userInput);
}
