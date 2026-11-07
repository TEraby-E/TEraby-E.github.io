#include <algorithm>
#include <iostream>
#include <string>
#include <utility>
#include <vector>

using namespace std;

int main() {
    int width, height;
    if (!(cin >> width >> height)) return 0;
    vector<string> grid(height);
    for (string& row : grid) cin >> row;

    const int dr[] = {-1, 1, 0, 0};
    const int dc[] = {0, 0, -1, 1};
    int answer = 0;
    vector<pair<int, int>> pending;
    for (int row = 0; row < height; ++row) {
        for (int col = 0; col < width; ++col) {
            if (grid[row][col] != '*') continue;
            pending.push_back({row, col});
            grid[row][col] = '.';
            int size = 0;
            while (!pending.empty()) {
                auto [r, c] = pending.back();
                pending.pop_back();
                ++size;
                for (int i = 0; i < 4; ++i) {
                    int nr = r + dr[i], nc = c + dc[i];
                    if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue;
                    if (grid[nr][nc] != '*') continue;
                    grid[nr][nc] = '.';
                    pending.push_back({nr, nc});
                }
            }
            answer = max(answer, size);
        }
    }
    cout << answer << '\n';
}
