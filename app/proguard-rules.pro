# Retrofit's Gson converter reads and writes these API models by field name.
# Keep JSON field names stable in minified release APKs; otherwise R8 turns
# LoginRequest.username/token into "a"/"b" and FastAPI rejects the body (422).
-keep class com.dilarion.app.data.model.** { <fields>; }
