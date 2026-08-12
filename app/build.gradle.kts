plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

android {
    namespace = "com.dilarion.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.dilarion.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 12
        versionName = "1.0.11"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            isDebuggable = true
        }
    }

    flavorDimensions += "env"
    productFlavors {
        create("production") {
            dimension = "env"
            buildConfigField("String", "BASE_URL", "\"https://apidilarion.eibstratoc.com/\"")
            buildConfigField("String", "WS_BASE", "\"wss://apidilarion.eibstratoc.com/ws\"")
        }
        // Named "staging", not "test": AGP reserves flavor names starting with
        // "test" for its own androidTest source sets and rejects the build.
        create("staging") {
            dimension = "env"
            versionNameSuffix = "-test"
            resValue("string", "app_name", "Dilarion Test")
            buildConfigField("String", "BASE_URL", "\"https://testdilarion.eibstratoc.com/\"")
            buildConfigField("String", "WS_BASE", "\"wss://testdilarion.eibstratoc.com/ws\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
            excludes += "META-INF/INDEX.LIST"
            excludes += "META-INF/io.netty.versions.properties"
        }
        jniLibs {
            pickFirsts += "**/libjingle_peerconnection_so.so"
        }
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.icons.extended)
    implementation(libs.compose.activity)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.navigation.compose)

    // Live camera preview in the pre-join lobby — separate from LiveKit's own
    // capture pipeline, which only starts once the call is actually joined.
    implementation("androidx.camera:camera-core:1.3.4")
    implementation("androidx.camera:camera-camera2:1.3.4")
    implementation("androidx.camera:camera-lifecycle:1.3.4")
    implementation("androidx.camera:camera-view:1.3.4")

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)

    implementation(libs.retrofit)
    implementation(libs.retrofit.gson)
    implementation(libs.okhttp.logging)

    implementation(libs.coroutines.android)
    implementation(libs.datastore.preferences)
    implementation(libs.security.crypto)

    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)

    implementation(libs.coil.compose)

    implementation("io.getstream:stream-webrtc-android:1.3.8")

    // Group video (LiveKit SFU). Compose components pull in livekit-android (core SDK)
    // transitively - not pinning the core artifact separately avoids a version conflict
    // between the two. Its WebRTC dep (io.github.webrtc-sdk:android-prefixed) shades
    // org.webrtc -> livekit.org.webrtc specifically to avoid colliding with
    // stream-webrtc-android above, which the 1:1/mesh call path uses.
    implementation("io.livekit:livekit-android-compose-components:2.4.0")

    // QR scanning for device linking
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
}
