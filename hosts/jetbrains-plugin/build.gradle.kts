plugins {
    id("java")
    id("org.jetbrains.intellij.platform") version "2.10.5"
    kotlin("jvm") version "2.3.20"
}

import org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile

group = "Caiqy.opencode"
version = findProperty("plugin.version")?.toString() ?: "26.2.15"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

java {
    // Align with IntelliJ Platform 2024.3+ requirement
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

kotlin {
    jvmToolchain(21)
}

sourceSets {
    test {
        kotlin {
            srcDir("src/test/kotlin")
        }
    }
    
    // Create a separate source set for unit tests that don't need IntelliJ
    create("unitTest") {
        kotlin {
            srcDir("src/unitTest/kotlin")
        }
        resources {
            srcDir("src/unitTest/resources")
        }
        compileClasspath += sourceSets.main.get().output + sourceSets.main.get().compileClasspath
        runtimeClasspath += output + compileClasspath + sourceSets.main.get().runtimeClasspath
    }
}

dependencies {
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.1")

    // IntelliJ Platform dependencies
    intellijPlatform {
        intellijIdea("2026.1.1")
        bundledPlugin("com.intellij.java")
        bundledPlugin("org.jetbrains.plugins.terminal")

        pluginVerifier()
        zipSigner()
    }

    testImplementation("org.junit.jupiter:junit-jupiter:5.10.0")
    testImplementation("org.mockito:mockito-core:5.5.0")
    testImplementation("org.mockito:mockito-inline:5.2.0")
    testImplementation("org.mockito.kotlin:mockito-kotlin:5.1.0")
    testImplementation(kotlin("test"))
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    
    // Unit test dependencies (plain JVM + JUnit, no IntelliJ TestIdeTask)
    "unitTestImplementation"("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.1")
    "unitTestImplementation"(kotlin("stdlib"))
    "unitTestImplementation"("org.junit.jupiter:junit-jupiter:5.10.0")
    "unitTestImplementation"("org.mockito:mockito-core:5.5.0")
    "unitTestImplementation"("org.mockito:mockito-inline:5.2.0")
    "unitTestImplementation"("org.mockito.kotlin:mockito-kotlin:5.1.0")
    "unitTestImplementation"(kotlin("test"))
    "unitTestRuntimeOnly"("org.junit.platform:junit-platform-launcher")
}

intellijPlatform {
    buildSearchableOptions.set(false)

    pluginConfiguration {
        ideaVersion {
            sinceBuild.set("261")
            untilBuild.set("261.*")
        }
        description = providers.provider {
            val f = file("description.html")
            if (!f.isFile) {
                return@provider "OpenCode UI (unofficial) brings local OpenCode AI workflows into JetBrains IDEs with chat, context management, and bundled backend binaries."
            }

            val text = f.readText().trim()
            if (text.isEmpty()) {
                "OpenCode UI (unofficial) brings local OpenCode AI workflows into JetBrains IDEs with chat, context management, and bundled backend binaries."
            } else {
                text
            }
        }
        changeNotes = providers.provider {
            val f = file("changelog.html")
            if (!f.isFile) {
                return@provider "See CHANGELOG.md for details."
            }

            val text = f.readText().trim()
            if (text.isEmpty()) {
                "See CHANGELOG.md for details."
            } else {
                text
            }
        }
    }

    signing {
        certificateChain = providers.environmentVariable("JETBRAINS_CERTIFICATE_CHAIN")
        privateKey = providers.environmentVariable("JETBRAINS_PRIVATE_KEY")
        password = providers.environmentVariable("JETBRAINS_PRIVATE_KEY_PASSWORD")
    }

    publishing {
        token = providers.environmentVariable("JETBRAINS_MARKETPLACE_TOKEN")
    }

    pluginVerification {
        ides {
            recommended()
        }
    }
}

tasks {
    processResources {
        val minVersion = project.findProperty("opencode.min.version")?.toString() ?: "1.1.1"
        val distributionChannel = project.findProperty("distribution.channel")?.toString() ?: "local"
        inputs.property("opencodeMinVersion", minVersion)
        inputs.property("distributionChannel", distributionChannel)
        filesMatching("opencode-build.properties") {
            expand(
                "opencodeMinVersion" to minVersion,
                "distributionChannel" to distributionChannel,
            )
        }
    }

    patchPluginXml {
        untilBuild.set("261.*")
    }

    prepareSandbox {
        from(rootProject.rootDir.resolve("LICENSE")) {
            into("${intellijPlatform.projectName.get()}")
        }
    }

    
    // Configure test task for IntelliJ integration tests
    test {
        useJUnitPlatform()
        
        systemProperty("java.awt.headless", "true")
        systemProperty("idea.test.cyclic.buffer.size", "1048576")
        systemProperty("idea.home.path", "")
        
        jvmArgs(
            "-Djava.awt.headless=true",
            "--add-opens=java.base/java.lang=ALL-UNNAMED",
            "--add-opens=java.base/java.util=ALL-UNNAMED"
        )
    }
    
    // Create unit test task that runs without IntelliJ TestIdeTask / sandbox setup
    register<Test>("unitTest") {
        testClassesDirs = sourceSets["unitTest"].output.classesDirs
        classpath = sourceSets["unitTest"].runtimeClasspath
        useJUnitPlatform()
        systemProperty("java.awt.headless", "true")
        jvmArgs(
            "-Djava.awt.headless=true",
            "--add-opens=java.base/java.lang=ALL-UNNAMED",
            "--add-opens=java.base/java.util=ALL-UNNAMED"
        )
    }

    named<KotlinJvmCompile>("compileUnitTestKotlin") {
        friendPaths.from(sourceSets.main.get().output.classesDirs)
    }
    
    // Make build depend on unit tests
    build {
        dependsOn("unitTest")
    }
}
