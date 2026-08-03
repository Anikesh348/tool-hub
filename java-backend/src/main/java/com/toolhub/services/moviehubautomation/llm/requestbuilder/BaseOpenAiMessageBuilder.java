package com.toolhub.services.moviehubautomation.llm.requestbuilder;

import com.toolhub.models.moviehubautomation.MediaState;
import io.vertx.core.json.JsonObject;

public interface BaseOpenAiMessageBuilder {

  JsonObject buildMessage(MediaState mediaState, String userInput);
}
