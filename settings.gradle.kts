pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // LiveKit's audioswitch transitive dep (com.github.davidliu:audioswitch) is
        // JitPack-hosted, not on Maven Central.
        maven { url = uri("https://jitpack.io") }
    }
}

rootProject.name = "DilarionApp"
include(":app")
