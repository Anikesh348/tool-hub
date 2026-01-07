package com.toolhub.services.moviehubautomation.llm.llimclient;

import com.toolhub.enums.moviehubautomation.AiModel;
import com.toolhub.models.moviehubautomation.LLMResponse;
import io.vertx.core.Future;
import io.vertx.core.json.JsonObject;

public interface AiClient {

    AiModel get();
    Future<LLMResponse> makeAiCall(JsonObject request);
}
