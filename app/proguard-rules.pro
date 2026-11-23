# Retrofit's Gson converter reads and writes these API models by field name.
# Keep JSON field names stable in minified release APKs; otherwise R8 turns
# LoginRequest.username/token into "a"/"b" and FastAPI rejects the body (422).
-keep class com.dilarion.app.data.model.** { <fields>; }
# Same for the sign-in approval models that sit beside their Retrofit interface.
-keep class com.dilarion.app.data.api.LoginOutcome { <fields>; }
-keep class com.dilarion.app.data.api.LoginRequestToken { <fields>; }
-keep class com.dilarion.app.data.api.LoginRequestMasterToken { <fields>; }
-keep class com.dilarion.app.data.api.LoginRequestState { <fields>; }
-keep class com.dilarion.app.data.api.PendingLoginRequest { <fields>; }
-keep class com.dilarion.app.data.api.PendingLoginRequests { <fields>; }
-keep class com.dilarion.app.data.api.LoginDecision { <fields>; }
