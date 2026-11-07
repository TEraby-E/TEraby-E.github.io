#include <iostream>
#include <queue>
#include <string>
#include <vector>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int rows, cols;
    if (!(cin >> rows >> cols)) return 0;
    string grid;
    grid.reserve(rows * cols);
    for (int i = 0; i < rows; ++i) {
        string line;
        cin >> line;
        grid += line;
    }
    // 把 (row, col) 映射成 row * cols + col，避免开正方形数组。
    int start = static_cast<int>(grid.find('s'));
    int finish = static_cast<int>(grid.find('t'));
    vector<int> dist(rows * cols, -1);
    queue<int> pending;
    dist[start] = 0;
    pending.push(start);
    const int dr[] = {-1, 1, 0, 0}, dc[] = {0, 0, -1, 1};
    while (!pending.empty()) {
        int p = pending.front();
        pending.pop();
        if (p == finish) break;
        int row = p / cols, col = p % cols;
        for (int d = 0; d < 4; ++d) {
            int r = row + dr[d], c = col + dc[d];
            if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
            int v = r * cols + c;
            if (grid[v] == '#' || dist[v] != -1) continue;
            dist[v] = dist[p] + 1;
            pending.push(v);
        }
    }
    cout << dist[finish] << '\n';
}
