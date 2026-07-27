configure_file(config.h.in config.h @ONLY)

add_library(libsnoretoast STATIC
  snoretoasts.cpp
  toasteventhandler.cpp
  linkhelper.cpp
  utils.cpp
)
target_link_libraries(libsnoretoast PUBLIC runtimeobject shlwapi user32)
target_compile_definitions(libsnoretoast
  PRIVATE UNICODE _UNICODE __WRL_CLASSIC_COM_STRICT__ WIN32_LEAN_AND_MEAN NOMINMAX
  PUBLIC __WRL_CLASSIC_COM_STRICT__
)
target_include_directories(libsnoretoast PUBLIC ${CMAKE_CURRENT_BINARY_DIR})
generate_export_header(libsnoretoast)

add_executable(snoretoast WIN32 main.cpp)
target_link_libraries(snoretoast PRIVATE libsnoretoast)
target_compile_definitions(snoretoast PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)

add_executable(snoretoast-foreground-test foregroundprocesstest.cpp)
target_link_libraries(snoretoast-foreground-test PRIVATE libsnoretoast)
target_compile_definitions(snoretoast-foreground-test PRIVATE UNICODE _UNICODE)
add_test(NAME snoretoast-foreground-test COMMAND snoretoast-foreground-test)
