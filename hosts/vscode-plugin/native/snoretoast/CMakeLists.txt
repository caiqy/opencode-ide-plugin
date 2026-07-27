cmake_minimum_required(VERSION 3.8)

project(snoretoast VERSION 0.7.0)
set(SNORETOAST_CALLBACK_GUID eb1fdd5b-8f70-4b5a-b230-998a2dc19303)

option(BUILD_STATIC_RUNTIME "Link statically to the MSVC runtime" ON)

include(GenerateExportHeader)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_INCLUDE_CURRENT_DIR ON)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/bin)

if(BUILD_STATIC_RUNTIME AND MSVC)
  foreach(build_type DEBUG RELEASE RELWITHDEBINFO)
    string(REPLACE "/MD" "/MT" CMAKE_CXX_FLAGS_${build_type} "${CMAKE_CXX_FLAGS_${build_type}}")
  endforeach()
endif()

enable_testing()
add_subdirectory(src)
